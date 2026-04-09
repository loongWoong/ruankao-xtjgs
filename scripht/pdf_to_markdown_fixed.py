from pdfminer.high_level import extract_text
import re

# 打开PDF文件
pdf_path = '/Users/wanglongzhen/Downloads/ruankao-xtjgs/03、【带搜索】系统架构设计师第二版.pdf'

# 提取PDF文本
def extract_text_from_pdf(pdf_path):
    text = extract_text(pdf_path)
    return text

# 将文本转换为markdown
def text_to_markdown(text):
    # 处理标题
    markdown = re.sub(r'^(第[一二三四五六七八九十百]+章|第\d+章)\s+(.+)$', r'# \1 \2', text, flags=re.MULTILINE)
    markdown = re.sub(r'^(\d+\.\d+)\s+(.+)$', r'## \1 \2', markdown, flags=re.MULTILINE)
    markdown = re.sub(r'^(\d+\.\d+\.\d+)\s+(.+)$', r'### \1 \2', markdown, flags=re.MULTILINE)
    
    # 处理列表
    markdown = re.sub(r'^\s*•\s+(.+)$', r'- \1', markdown, flags=re.MULTILINE)
    markdown = re.sub(r'^\s*\d+\.\s+(.+)$', r'1. \1', markdown, flags=re.MULTILINE)
    
    # 处理空行
    markdown = re.sub(r'\n{3,}', r'\n\n', markdown)
    
    return markdown

# 执行转换
if __name__ == '__main__':
    try:
        text = extract_text_from_pdf(pdf_path)
        markdown = text_to_markdown(text)
        
        # 保存为markdown文件
        output_path = '/Users/wanglongzhen/Downloads/ruankao-xtjgs/系统架构设计师第二版_fixed.md'
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(markdown)
        
        print(f'PDF转换为markdown成功，保存到: {output_path}')
    except Exception as e:
        print(f'转换失败: {str(e)}')