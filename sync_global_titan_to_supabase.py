import json
import sys
sys.path.append("/Users/huanggin-chen/gemini-stock-analysis")
from stock_sync import get_supabase_conn

def sync_to_supabase():
    print("[*] 正在載入已更新的 defaultMarketMlData.json ...")
    with open("frontend/src/data/defaultMarketMlData.json", "r", encoding="utf-8") as f:
        def_data = json.load(f)

    conn = get_supabase_conn()
    cur = conn.cursor()

    # 1. 更新 taiex_macro
    print("[*] 更新 stock_ml_cache -> taiex_macro ...")
    cur.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'taiex_macro';")
    row_macro = cur.fetchone()
    if row_macro:
        p_macro = row_macro[0] if isinstance(row_macro[0], dict) else json.loads(row_macro[0])
        # 同步頂層
        p_macro['selected_model'] = 'global_liquid_titan_a'
        p_macro['best_model_id'] = 'global_liquid_titan_a'
        
        if 'models' not in p_macro:
            p_macro['models'] = {}
        p_macro['models']['global_liquid_titan_a'] = def_data['models']['global_liquid_titan_a']

        bt_macro = p_macro.get('backtest_simulation', {})
        bt_def = def_data.get('backtest_simulation', {})
        bt_macro['selected_model_id'] = 'global_liquid_titan_a'
        bt_macro['open_positions'] = bt_def['open_positions']
        bt_macro['titan_open_positions'] = bt_def['titan_open_positions']
        if 'stats' in bt_def:
            bt_macro['stats'] = bt_def['stats']

        if 'periods' not in bt_macro:
            bt_macro['periods'] = {}
        
        for p_key, p_val in bt_def.get('periods', {}).items():
            if p_key in bt_macro['periods']:
                # 注入 global_liquid_titan_a 至 comparison 與 models_detail
                target_p = bt_macro['periods'][p_key]
                if 'comparison_long_only' in p_val:
                    target_p['comparison_long_only'] = p_val['comparison_long_only']
                if 'comparison_long_short' in p_val:
                    target_p['comparison_long_short'] = p_val['comparison_long_short']
                if 'models_detail' not in target_p:
                    target_p['models_detail'] = {}
                target_p['models_detail']['global_liquid_titan_a'] = p_val['models_detail']['global_liquid_titan_a']
            else:
                bt_macro['periods'][p_key] = p_val

        p_macro['backtest_simulation'] = bt_macro

        cur.execute("""
            UPDATE stock_ml_cache
            SET payload = %s, updated_at = CURRENT_TIMESTAMP
            WHERE model_type = 'taiex_macro';
        """, (json.dumps(p_macro, ensure_ascii=False),))
        print("[✓] Supabase taiex_macro 成功更新為 Top 3 冠軍 (global_liquid_titan_a)！")

    # 2. 更新 taiex_macro_bt
    print("[*] 更新 stock_ml_cache -> taiex_macro_bt ...")
    cur.execute("SELECT payload FROM stock_ml_cache WHERE model_type = 'taiex_macro_bt';")
    row_bt = cur.fetchone()
    if row_bt:
        p_bt = row_bt[0] if isinstance(row_bt[0], dict) else json.loads(row_bt[0])
        p_bt['selected_model'] = 'global_liquid_titan_a'
        p_bt['best_model_id'] = 'global_liquid_titan_a'

        bt_sim = p_bt.get('backtest_simulation', p_bt)
        bt_sim['selected_model_id'] = 'global_liquid_titan_a'
        bt_sim['open_positions'] = def_data['backtest_simulation']['open_positions']
        bt_sim['titan_open_positions'] = def_data['backtest_simulation']['titan_open_positions']
        if 'stats' in def_data['backtest_simulation']:
            bt_sim['stats'] = def_data['backtest_simulation']['stats']

        if 'periods' in bt_sim:
            for p_key, p_val in def_data['backtest_simulation'].get('periods', {}).items():
                if p_key in bt_sim['periods']:
                    target_p = bt_sim['periods'][p_key]
                    if 'comparison_long_only' in p_val:
                        target_p['comparison_long_only'] = p_val['comparison_long_only']
                    if 'comparison_long_short' in p_val:
                        target_p['comparison_long_short'] = p_val['comparison_long_short']
                    if 'models_detail' not in target_p:
                        target_p['models_detail'] = {}
                    target_p['models_detail']['global_liquid_titan_a'] = p_val['models_detail']['global_liquid_titan_a']

        cur.execute("""
            UPDATE stock_ml_cache
            SET payload = %s, updated_at = CURRENT_TIMESTAMP
            WHERE model_type = 'taiex_macro_bt';
        """, (json.dumps(p_bt, ensure_ascii=False),))
        print("[✓] Supabase taiex_macro_bt 成功更新為 Top 3 冠軍 (global_liquid_titan_a)！")

    conn.commit()
    cur.close()
    conn.close()
    print("[🌟] Supabase stock_ml_cache 全部同步完成！")

if __name__ == '__main__':
    sync_to_supabase()
