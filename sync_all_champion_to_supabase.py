import json
import sys
import os
from datetime import datetime

sys.path.append("/Users/huanggin-chen/openclaw_test")
from stock_sync import get_supabase_conn
import global_sovereign_service

def sync_all():
    print("=" * 80)
    print("🚀 [1/5] 同步最新 17 因子全球泰坦數據至 defaultGlobalSovereignData.json ...")
    gs_data = global_sovereign_service.get_global_sovereign_dashboard_data()
    def_path = "frontend/src/data/defaultGlobalSovereignData.json"
    with open(def_path, "w", encoding="utf-8") as f:
        json.dump(gs_data, f, ensure_ascii=False, indent=2)
    print("  ✓ defaultGlobalSovereignData.json 已更新完成，目前 Top 3:", [p['ticker'] for p in gs_data['current_picks'][:3]])

    print("\n🚀 [2/5] 連線至 Supabase PostgreSQL 資料庫 ...")
    conn = get_supabase_conn()
    cur = conn.cursor()

    # 1. 寫入 global_sovereign_dashboard 至 stock_ml_cache
    print("  -> 寫入 stock_ml_cache [global_sovereign_dashboard] ...")
    cur.execute("""
        INSERT INTO stock_ml_cache (model_type, payload, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (model_type) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
    """, ("global_sovereign_dashboard", json.dumps(gs_data, ensure_ascii=False)))
    print("  ✓ stock_ml_cache [global_sovereign_dashboard] 寫入成功！")

    # 2. 讀取 defaultMarketMlData.json
    print("\n🚀 [3/5] 同步 17 因子 DOE 終極冠軍至 stock_ml_cache [taiex_macro] ...")
    with open("frontend/src/data/defaultMarketMlData.json", "r", encoding="utf-8") as f:
        def_market = json.load(f)

    champ_model_id = "global_liquid_titan_champion_17f"
    champ_model_obj = def_market["models"][champ_model_id]

    cur.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'taiex_macro';")
    row = cur.fetchone()
    p_macro = row[0] if (row and isinstance(row[0], dict)) else (json.loads(row[0]) if row else {})
    if not p_macro:
        p_macro = def_market
    else:
        p_macro['selected_model'] = champ_model_id
        p_macro['best_model_id'] = champ_model_id
        if 'models' not in p_macro:
            p_macro['models'] = {}
        p_macro['models'][champ_model_id] = champ_model_obj
        p_macro['models']['global_liquid_titan_sniper'] = def_market['models'].get('global_liquid_titan_sniper', {})
        p_macro['backtest_simulation'] = def_market['backtest_simulation']

    cur.execute("""
        INSERT INTO stock_ml_cache (model_type, payload, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (model_type) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
    """, ("taiex_macro", json.dumps(p_macro, ensure_ascii=False)))
    print("  ✓ stock_ml_cache [taiex_macro] 寫入成功 (selected_model = global_liquid_titan_champion_17f)！")

    # 3. 寫入 taiex_macro_bt
    print("\n🚀 [4/5] 同步 17 因子 DOE 終極冠軍至 stock_ml_cache [taiex_macro_bt] ...")
    cur.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'taiex_macro_bt';")
    row_bt = cur.fetchone()
    p_bt = row_bt[0] if (row_bt and isinstance(row_bt[0], dict)) else (json.loads(row_bt[0]) if row_bt else {})
    
    # 直接以包含完整 17 因子 20 年回測各期詳細數據之 backtest_simulation 為核心
    bt_payload = def_market['backtest_simulation']
    bt_payload['selected_model_id'] = champ_model_id
    bt_payload['selected_model'] = champ_model_id
    bt_payload['best_model_id'] = champ_model_id

    cur.execute("""
        INSERT INTO stock_ml_cache (model_type, payload, updated_at)
        VALUES (%s, %s, CURRENT_TIMESTAMP)
        ON CONFLICT (model_type) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP;
    """, ("taiex_macro_bt", json.dumps(bt_payload, ensure_ascii=False)))
    print("  ✓ stock_ml_cache [taiex_macro_bt] 寫入成功！")

    # 4. 清除 hotpotlu 之 dismissed_suggestions，重置調倉建議
    print("\n🚀 [5/5] 重置 hotpotlu 之已消掉建議 (dismissed_suggestions = []) ...")
    cur.execute("""
        UPDATE user_titan_portfolios
        SET dismissed_suggestions = '[]', updated_at = CURRENT_TIMESTAMP
        WHERE username = 'hotpotlu';
    """)
    print("  ✓ hotpotlu 專屬帳本之 dismissed_suggestions 已重設為空陣列！")

    conn.commit()
    cur.close()
    conn.close()
    print("=" * 80)
    print("🌟 雲端 Supabase 與本機全部快取同步完成！")

if __name__ == '__main__':
    sync_all()
