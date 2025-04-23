import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as zlib from 'node:zlib';
import { type GalleryRow, namespaces } from './types.ts';

// 原数据库，仅以只读方式打开
const ORIG_DB_PATH =
    'Y:/downloads/e-hentai_exhentai_metadata_api_dump_gp_crawl_database_archive_2025_01_08/api_dump.sqlite/api_dump.sqlite';
const origDb = new Database(ORIG_DB_PATH, { readonly: true });

// 新数据库路径（会自动创建）
const AGG_DB_PATH = 'aggregated.sqlite';
fs.rmSync(AGG_DB_PATH, { force: true });
const aggDb = new Database(AGG_DB_PATH);

// 修改创建 tag_aggregate 表，删除 gid 和 gtoken 列，新增 galleries 列
aggDb.exec(`DROP TABLE IF EXISTS tag_aggregate`);
aggDb.exec(`
  CREATE TABLE tag_aggregate (
    namespace TEXT,
    tag TEXT,
    count INTEGER,
    galleries TEXT
  )
`);

// 聚合结果 Map，key = "${namespace}||${tag}"，value 保存 { count, candidates }
// candidates 用于保存满足有效条件的记录，后续取 5 条，构造 galleries 字符串
const tagAgg = new Map<
    string,
    {
        count: number;
        candidates: Array<{ gid: number; token: string; posted: number }>;
    }
>();

// 获取 gallery 表总记录数，用于进度提示
const totalRows = origDb
    .prepare<[], { count: number }>('SELECT COUNT(*) as count FROM gallery WHERE current_gid is NULL')
    .get()!.count;
console.log(`总记录数: ${totalRows}`);

let processed = 0;
const progressInterval = Math.ceil(totalRows / 100); // 每处理约 1% 记录时打印一次

// 有效判断所用的 dumped 阈值（Unix timestamp 格式），Date.parse 返回毫秒需除以1000
const validDumpedThreshold = Date.parse('2024/12/15') / 1000;

for (const row of origDb.prepare<[], GalleryRow>('SELECT * FROM gallery WHERE current_gid is NULL').iterate()) {
    for (const ns of namespaces) {
        const field = row[ns];
        if (!field) continue;
        let tags: string[] = [];
        try {
            // 将类似 "['tag1','tag2']" 的字段转换为 JSON 字符串
            const jsonStr = field.replace(/'/g, '"');
            tags = JSON.parse(jsonStr) as string[];
            if (!Array.isArray(tags)) tags = [];
        } catch {
            console.error(`Namespace ${ns} 标签解析错误: ${field}`);
            continue;
        }
        for (const tag of tags) {
            const key = `${ns}||${tag}`;
            let entry = tagAgg.get(key);
            if (!entry) {
                entry = {
                    count: 0,
                    candidates: [],
                };
                tagAgg.set(key, entry);
            }
            // 累加出现次数，不论是否满足有效条件
            entry.count++;
            // 有效判断条件：!expunged && !removed && (dumped ?? 0) > validDumpedThreshold
            const valid = row.expunged === 0 && row.removed === 0 && (row.dumped ?? 0) > validDumpedThreshold;
            if (valid) {
                // 记录该条记录的 gid、token 和 posted
                entry.candidates.push({
                    gid: row.gid,
                    token: row.token,
                    posted: row.posted ?? 0,
                });
            }
        }
    }
    processed++;
    if (processed % progressInterval === 0) {
        const percent = ((processed / totalRows) * 100).toFixed(2);
        console.log(`已处理 ${processed} / ${totalRows} (${percent}%)`);
    }
}

// 将 tagAgg Map 转换为数组并按 count 降序排序
const entriesSorted = Array.from(tagAgg.entries()).sort((a, b) => b[1].count - a[1].count);

// 插入聚合结果到新数据库中的 tag_aggregate 表
const insertStmt = aggDb.prepare(`
  INSERT INTO tag_aggregate (namespace, tag, count, galleries) VALUES (?, ?, ?, ?)
`);
const insertTxn = aggDb.transaction(
    (
        entries: Array<[string, { count: number; candidates: Array<{ gid: number; token: string; posted: number }> }]>,
    ) => {
        for (const [key, { count, candidates }] of entries) {
            const [namespace, tag] = key.split('||');
            // 按 posted 降序排序
            // 取出前 5 个候选项，构造 galleries 字符串
            const topCandidates = candidates.sort((a, b) => b.posted - a.posted).slice(0, 5);
            const galleries = topCandidates.map((c) => `${c.gid}/${c.token}`).join('\n');
            insertStmt.run(namespace, tag, count, galleries);
        }
    },
);
insertTxn(entriesSorted);

console.log('聚合完成，新数据库已创建并保存聚合结果到 tag_aggregate 表。');

// 创建 dumped_distribution 表（包含 date, count 两列）
aggDb.exec(`DROP TABLE IF EXISTS dumped_distribution`);
aggDb.exec(`
  CREATE TABLE dumped_distribution (
    date TEXT,
    count INTEGER
  )
`);

// 查询 gallery 表中 dumped 字段的分布（转换为 YYYY-mm-dd 格式）
const distributionQuery = `
  SELECT strftime('%Y-%m-%d', datetime(dumped, 'unixepoch')) AS date, count(*) AS count 
  FROM gallery 
  GROUP BY date
`;

// 插入统计结果到 dumped_distribution 表中
const insertDistributionStmt = aggDb.prepare<[string, number], void>(`
  INSERT INTO dumped_distribution (date, count) VALUES (?, ?)
`);

for (const row of origDb.prepare<[], { date: string; count: number }>(distributionQuery).iterate()) {
    insertDistributionStmt.run(row.date, row.count);
}

console.log('dumped 字段分布统计完成，新数据库的 dumped_distribution 表已更新。');

origDb.close();
aggDb.close();

const input = fs.createReadStream(AGG_DB_PATH);
const output = fs.createWriteStream(`${AGG_DB_PATH}.gz`);
const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
input
    .pipe(gzip)
    .pipe(output)
    .on('finish', () => {
        console.log(`数据库已压缩为 ${AGG_DB_PATH}.gz`);
    });
