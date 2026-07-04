import sys
import json

sys.path.insert(0, '.')
from app import app

client = app.test_client()

print("=" * 60)
print("知识点体系化功能冒烟测试")
print("=" * 60)

def test_endpoint(name, method, path, expected_status=200):
    print(f"\n测试: {name}")
    print(f"  接口: {method} {path}")
    resp = client.get(path) if method == 'GET' else client.post(path)
    print(f"  状态码: {resp.status_code}")
    assert resp.status_code == expected_status, f"期望 {expected_status}, 实际 {resp.status_code}"
    data = resp.get_json()
    print(f"  响应数据(部分): {json.dumps(data, ensure_ascii=False)[:200]}...")
    return data

try:
    data = test_endpoint("1. 知识点树", "GET", "/api/knowledge/tree")
    assert "tree" in data
    tree = data["tree"]
    print(f"  顶级节点数: {len(tree)}")
    assert len(tree) >= 6, f"期望至少6个顶级节点, 实际 {len(tree)}"
    
    chapter_found = False
    for node in tree:
        if "第1章" in node["name"] or "第一章" in node["name"]:
            chapter_found = True
            assert "children" in node
            assert "mastery_score" in node
            print(f"  找到第一章: {node['name']}")
            print(f"  子节点数: {len(node['children'])}")
            break
    assert chapter_found, "未找到系统架构师大纲的第一章数据"
    print("  ✅ 通过")

    data = test_endpoint("2. 单个知识点详情", "GET", "/api/knowledge/1")
    assert "id" in data
    assert "name" in data
    assert "mastery_score" in data
    assert "wrong_question_count" in data
    print(f"  知识点名: {data['name']}")
    print(f"  掌握度: {data['mastery_score']}")
    print("  ✅ 通过")

    data = test_endpoint("3. 最薄弱知识点", "GET", "/api/knowledge/weakest?limit=5")
    assert "weak_points" in data
    weak_points = data["weak_points"]
    print(f"  返回数量: {len(weak_points)}")
    assert len(weak_points) == 5, f"期望5个, 实际 {len(weak_points)}"
    for wp in weak_points:
        assert "mastery_score" in wp
        assert "level" in wp
        assert wp["level"] == 3
    print(f"  最薄弱: {weak_points[0]['name']} (分数: {weak_points[0]['mastery_score']})")
    print("  ✅ 通过")

    data = test_endpoint("4. 学习进度", "GET", "/api/knowledge/progress")
    assert "progress" in data
    progress = data["progress"]
    print(f"  章节数: {len(progress)}")
    assert len(progress) >= 6, f"期望至少6章, 实际 {len(progress)}"
    for ch in progress[:3]:
        assert "sections" in ch
        assert "avg_mastery" in ch
        assert "total_kps" in ch
        print(f"  {ch['name']}: {ch['total_kps']}个知识点, 平均掌握度 {ch['avg_mastery']}")
    print("  ✅ 通过")

    data = test_endpoint("5. 不存在的知识点", "GET", "/api/knowledge/99999", expected_status=404)
    assert "error" in data
    print("  ✅ 通过")

    data = test_endpoint("6. 带user_id的知识点树", "GET", "/api/knowledge/tree?user_id=test_user")
    assert "tree" in data
    print("  ✅ 通过")

    data = test_endpoint("7. 验证大纲数据完整性", "GET", "/api/knowledge/tree")
    tree = data["tree"]
    
    def count_nodes(nodes, level):
        count = 0
        for n in nodes:
            if n.get("level") == level:
                count += 1
            count += count_nodes(n.get("children", []), level)
        return count
    
    level1_count = len([n for n in tree if n.get("level") == 1])
    level2_count = count_nodes(tree, 2)
    level3_count = count_nodes(tree, 3)
    print(f"  level=1 节点数: {level1_count}")
    print(f"  level=2 节点数: {level2_count}")
    print(f"  level=3 节点数: {level3_count}")
    assert level1_count >= 6
    assert level2_count >= 18
    assert level3_count >= 52
    print("  ✅ 通过")

    print("\n" + "=" * 60)
    print("🎉 所有测试通过!")
    print("=" * 60)

except AssertionError as e:
    print(f"\n❌ 测试失败: {e}")
    sys.exit(1)
except Exception as e:
    print(f"\n❌ 异常: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
