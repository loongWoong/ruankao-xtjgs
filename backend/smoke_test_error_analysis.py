import sys
import json
from datetime import datetime, timedelta

sys.path.insert(0, '.')
from app import app

client = app.test_client()

print("=" * 60)
print("错题深度归因功能冒烟测试")
print("=" * 60)

def test_endpoint(name, method, path, json_data=None, expected_status=200):
    print(f"\n测试: {name}")
    print(f"  接口: {method} {path}")
    if method == 'GET':
        resp = client.get(path)
    elif method == 'POST':
        resp = client.post(path, json=json_data or {})
    elif method == 'PUT':
        resp = client.put(path, json=json_data or {})
    else:
        resp = client.delete(path)
    print(f"  状态码: {resp.status_code}")
    assert resp.status_code == expected_status, f"期望 {expected_status}, 实际 {resp.status_code}"
    data = resp.get_json()
    data_str = json.dumps(data, ensure_ascii=False)
    if len(data_str) > 400:
        print(f"  响应数据(部分): {data_str[:400]}...")
    else:
        print(f"  响应数据: {data_str}")
    return data

test_user = 'test_error_analysis_user'
test_question_id = None
test_tag_ids = []

try:
    data = test_endpoint(
        "1. 获取所有错误标签",
        "GET",
        "/api/error-analysis/tags"
    )
    assert 'categories' in data
    assert 'all_tags' in data
    assert isinstance(data['categories'], list)
    assert isinstance(data['all_tags'], list)
    assert len(data['all_tags']) == 18
    categories = [c['category'] for c in data['categories']]
    assert 'concept' in categories
    assert 'memory' in categories
    assert 'calculation' in categories
    assert 'reading' in categories
    assert 'logic' in categories
    test_tag_ids = [t['id'] for t in data['all_tags'][:5]]
    print(f"  标签总数: {len(data['all_tags'])}")
    print(f"  分类数: {len(data['categories'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "2. 添加一道概念混淆类型错题",
        "POST",
        "/api/wrong-questions",
        json_data={
            'user_id': test_user,
            'question': '进程和线程的主要区别是什么？',
            'options': [
                'A. 进程是资源分配的基本单位，线程是CPU调度的基本单位',
                'B. 进程是CPU调度的基本单位，线程是资源分配的基本单位',
                'C. 进程和线程没有本质区别',
                'D. 线程不能并发执行'
            ],
            'user_answer': 'B',
            'correct_answer': 'A',
            'analysis': '进程是资源分配的基本单位，线程是CPU调度的基本单位。',
            'category': '操作系统',
            'chapter': '进程管理'
        }
    )
    assert data['success'] is True
    test_question_id = data['id']
    print(f"  题目ID: {test_question_id}")
    print("  ✅ 通过")

    data = test_endpoint(
        "3. 分析单道错题（自动归因）",
        "POST",
        f"/api/error-analysis/analyze/{test_question_id}?user_id={test_user}"
    )
    assert data['success'] is True
    assert data['question_id'] == test_question_id
    assert 'tags' in data
    assert isinstance(data['tags'], list)
    assert len(data['tags']) > 0
    for tag in data['tags']:
        assert 'id' in tag
        assert 'name' in tag
        assert 'category' in tag
        assert 'confidence' in tag
    print(f"  匹配标签数: {len(data['tags'])}")
    print(f"  标签列表: {[t['name'] for t in data['tags']]}")
    print("  ✅ 通过")

    data = test_endpoint(
        "4. 获取单题错误分析详情",
        "GET",
        f"/api/error-analysis/questions/{test_question_id}?user_id={test_user}"
    )
    assert 'question' in data
    assert 'tags' in data
    assert 'suggestions' in data
    assert 'related_knowledge_points' in data
    assert isinstance(data['tags'], list)
    assert isinstance(data['suggestions'], list)
    print(f"  建议数: {len(data['suggestions'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "5. 添加一道审题不清类型错题",
        "POST",
        "/api/wrong-questions",
        json_data={
            'user_id': test_user,
            'question': '以下哪个不是操作系统的功能？',
            'options': [
                'A. 进程管理',
                'B. 存储管理',
                'C. 编译程序',
                'D. 文件管理'
            ],
            'user_answer': 'A',
            'correct_answer': 'C',
            'analysis': '操作系统的功能包括进程管理、存储管理、文件管理等，编译程序不是操作系统的功能。',
            'category': '操作系统',
            'chapter': '操作系统概述'
        }
    )
    assert data['success'] is True
    question2_id = data['id']
    print(f"  题目ID: {question2_id}")
    print("  ✅ 通过")

    data = test_endpoint(
        "6. 添加一道多选题（步骤遗漏类型）",
        "POST",
        "/api/wrong-questions",
        json_data={
            'user_id': test_user,
            'question': '以下哪些属于操作系统的功能？',
            'options': [
                'A. 进程管理',
                'B. 存储管理',
                'C. 文件管理',
                'D. 编译程序'
            ],
            'user_answer': 'AB',
            'correct_answer': 'ABC',
            'analysis': '操作系统的主要功能包括：进程管理、存储管理、文件管理、设备管理、作业管理。',
            'category': '操作系统',
            'chapter': '操作系统概述'
        }
    )
    assert data['success'] is True
    question3_id = data['id']
    print(f"  题目ID: {question3_id}")
    print("  ✅ 通过")

    data = test_endpoint(
        "7. 批量分析所有未分析的错题",
        "POST",
        f"/api/error-analysis/batch-analyze?user_id={test_user}"
    )
    assert data['success'] is True
    assert 'newly_analyzed' in data
    assert 'already_analyzed' in data
    assert 'total_questions' in data
    assert 'unanalyzed' in data
    print(f"  新分析: {data['newly_analyzed']}")
    print(f"  已分析: {data['already_analyzed']}")
    print(f"  总题数: {data['total_questions']}")
    print("  ✅ 通过")

    data = test_endpoint(
        "8. 获取错误分布（饼图数据）",
        "GET",
        f"/api/error-analysis/distribution?user_id={test_user}"
    )
    assert 'pie_data' in data
    assert 'tag_stats' in data
    assert 'total_errors' in data
    assert isinstance(data['pie_data'], list)
    assert isinstance(data['tag_stats'], list)
    print(f"  总错误数: {data['total_errors']}")
    print(f"  分类数: {len(data['pie_data'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "9. 获取错误趋势（最近30天）",
        "GET",
        f"/api/error-analysis/trend?user_id={test_user}&days=30"
    )
    assert 'days' in data
    assert 'daily_trend' in data
    assert 'category_trend' in data
    assert data['days'] == 30
    assert isinstance(data['daily_trend'], list)
    assert isinstance(data['category_trend'], list)
    assert len(data['daily_trend']) == 30
    print(f"  趋势天数: {len(data['daily_trend'])}")
    print(f"  分类趋势数: {len(data['category_trend'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "10. 手动添加/修改标签",
        "POST",
        f"/api/error-analysis/questions/{test_question_id}/tags?user_id={test_user}",
        json_data={
            'tag_ids': test_tag_ids[:3]
        }
    )
    assert data['success'] is True
    assert data['question_id'] == test_question_id
    assert 'tags' in data
    assert len(data['tags']) == 3
    print(f"  手动设置标签数: {len(data['tags'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "11. 获取针对性练习推荐",
        "GET",
        f"/api/error-analysis/recommendations?user_id={test_user}&limit=5"
    )
    assert 'questions' in data
    assert 'weak_knowledge_points' in data
    assert 'top_error_types' in data
    assert isinstance(data['questions'], list)
    assert isinstance(data['weak_knowledge_points'], list)
    assert isinstance(data['top_error_types'], list)
    print(f"  推荐题目数: {len(data['questions'])}")
    print(f"  薄弱知识点数: {len(data['weak_knowledge_points'])}")
    print(f"  主要错误类型数: {len(data['top_error_types'])}")
    print("  ✅ 通过")

    data = test_endpoint(
        "12. 再次批量分析（应该没有新分析的）",
        "POST",
        f"/api/error-analysis/batch-analyze?user_id={test_user}"
    )
    assert data['success'] is True
    assert data['newly_analyzed'] == 0
    print(f"  新分析: {data['newly_analyzed']}")
    print("  ✅ 通过")

    print("\n" + "=" * 60)
    print("🎉 所有测试通过！错题深度归因功能正常工作。")
    print("=" * 60)

except AssertionError as e:
    print(f"\n❌ 测试失败: {e}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ 发生异常: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
