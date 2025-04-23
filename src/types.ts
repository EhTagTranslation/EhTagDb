export interface GalleryRow {
    // 标签字段，可能为存储类似 "['tag1','tag2']" 的字符串
    reclass?: string | null;
    language?: string | null;
    parody?: string | null;
    character?: string | null;
    group?: string | null;
    artist?: string | null;
    cosplayer?: string | null;
    male?: string | null;
    female?: string | null;
    mixed?: string | null;
    other?: string | null;

    // 状态字段
    expunged: number;
    removed: number;

    // dumped 字段为 Unix 时间戳，可能为 null
    dumped: number | null;

    // 其他用于聚合的字段
    rating: number;
    gid: number;
    token: string;
    title: string | null;
    title_jpn: string | null;
    // posted 字段为 Unix 时间戳，可能为 null
    posted: number | null;
    uploader: string | null;

    // 父节点
    parent_gid: number | null;
    parent_key: string | null;

    // 头节点
    first_gid: number | null;
    first_key: string | null;

    // 尾节点
    current_gid: number | null;
    current_key: string | null;

    // 附加其他字段，如有需要可以扩展
    [key: string]: unknown;
}

// 将需要处理的标签命名空间导出
export const namespaces = [
    'reclass',
    'language',
    'parody',
    'character',
    'group',
    'artist',
    'cosplayer',
    'male',
    'female',
    'mixed',
    'other',
] as const;
