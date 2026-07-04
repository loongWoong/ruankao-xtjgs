"""一次性脚本：将教材MD按章节切分并入库到 textbook_chapters 表。

用法：
    cd backend && python3 seed_textbook.py

教材MD结构较松散，章节标题格式不统一。本脚本采用如下策略：
1. 以 "# 第N章" 或 "第N章...知识" 形式的行作为一级章节分隔点。
2. 每个章节正文即为该标题到下一章节标题之间的内容。
3. 仅切分主要章节（共上篇+下篇约20章），章节内部不再细分二级，保证可用性。
"""
import os
import re
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'ruankao.db')
MD_PATH = os.path.join(BASE_DIR, '..', 'docc', '系统架构设计师第二版_fixed.md')

# 章节标题正则：匹配 "第1章" 到 "第20章"，允许中间有空格
CHAPTER_RE = re.compile(r'^#?\s*第\s*([0-9一二三四五六七八九十]+)\s*章')


def normalize_chapter_num(raw):
    """将章节号统一为阿拉伯数字字符串"""
    cn_map = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7,
              '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12, '十三': 13,
              '十四': 14, '十五': 15, '十六': 16, '十七': 17, '十八': 18,
              '十九': 19, '二十': 20}
    if raw.isdigit():
        return raw
    return str(cn_map.get(raw, raw))


def extract_title(line):
    """从章节标题行提取标题文本"""
    # 去掉 # 前缀和"第N章"前缀
    line = re.sub(r'^#+\s*', '', line)
    line = re.sub(r'^第\s*[0-9一二三四五六七八九十]+\s*章\s*', '', line)
    # 去掉目录页码点 "………145" 及后续内容
    line = re.split(r'[.．]{3,}|…{2,}', line)[0]
    # 去掉行尾页码
    line = re.sub(r'\s*\d+\s*$', '', line)
    # 去掉多余空格
    line = re.sub(r'\s+', '', line)
    return line.strip() or f'第章'


def split_chapters(md_text):
    """将整篇MD按章切分并按章节号聚合，返回 [(chapter_num, title, content), ...]

    教材MD中"第N章"在目录和每页页眉重复出现，因此按章节号聚合：
    同一章节号的所有片段合并为一条记录，标题取首次出现的完整标题。
    """
    lines = md_text.split('\n')
    # 按章节号聚合: {num: {'title': ..., 'parts': [str, ...], 'first_pos': int}}
    agg = {}

    current_num = None
    current_lines = []

    def flush():
        if current_num is not None:
            content = '\n'.join(current_lines).strip()
            if content:
                entry = agg.setdefault(current_num, {'title': '', 'parts': [], 'first_pos': len(agg)})
                entry['parts'].append(content)
                if not entry['title']:
                    entry['title'] = current_title or f'第{current_num}章'

    for line in lines:
        m = CHAPTER_RE.match(line)
        if m:
            flush()
            current_num = normalize_chapter_num(m.group(1))
            current_title = extract_title(line)
            current_lines = []
        else:
            if current_num is not None:
                current_lines.append(line)
    flush()

    # 按首次出现顺序输出
    chapters = []
    for num in sorted(agg.keys(), key=lambda n: agg[n]['first_pos']):
        entry = agg[num]
        content = '\n\n'.join(entry['parts'])
        chapters.append((num, entry['title'], content))
    return chapters


def make_summary(content, max_len=150):
    """生成章节摘要：取前若干非空、非标题行"""
    for line in content.split('\n'):
        s = line.strip()
        if s and not s.startswith('#') and not s.startswith('第'):
            # 清理多余空白
            s = re.sub(r'\s+', ' ', s)
            return s[:max_len]
    return ''


def main():
    if not os.path.exists(MD_PATH):
        print(f'教材文件不存在: {MD_PATH}')
        return

    with open(MD_PATH, 'r', encoding='utf-8') as f:
        md_text = f.read()

    chapters = split_chapters(md_text)
    print(f'共切分出 {len(chapters)} 个章节')

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 清空旧数据（重新切分）
    cursor.execute('DELETE FROM textbook_chapters')

    sort_order = 0
    for num, title, content in chapters:
        if not content or len(content) < 200:
            # 跳过内容过短的伪章节
            continue
        word_count = len(content)
        summary = make_summary(content)
        sort_order += 1
        cursor.execute('''
            INSERT INTO textbook_chapters
            (chapter_num, title, content, summary, word_count, parent_id, level, sort_order)
            VALUES (?, ?, ?, ?, ?, NULL, 1, ?)
        ''', (num, title or f'第{num}章', content, summary, word_count, sort_order))
        print(f'  已入库 第{num}章 {title[:30]}  ({word_count} 字)')

    conn.commit()
    conn.close()
    print(f'\n完成，共入库 {sort_order} 章')


if __name__ == '__main__':
    main()
