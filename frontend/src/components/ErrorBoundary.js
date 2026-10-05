import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleClearCacheAndReload = () => {
    try {
      localStorage.removeItem('market_operations_model_v2');
      localStorage.removeItem('market_operations_mode_v2');
      localStorage.removeItem('market_backtest_model_v2');
      localStorage.removeItem('market_bt_period_v2');
      localStorage.removeItem('market_ml_sub_tab');
      localStorage.removeItem('market_ml_model_type');
    } catch (e) {
      console.warn('Failed to clear some localStorage items:', e);
    }
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
          color: '#F8FAFC'
        }}>
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: '16px',
            padding: '2.5rem 2rem',
            maxWidth: '650px',
            width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontSize: '1.4rem', color: '#F87171', margin: '0 0 0.75rem 0' }}>
              系統即時載入異常
            </h2>
            <p style={{ fontSize: '0.92rem', color: '#CBD5E1', lineHeight: 1.6, margin: '0 0 1.5rem 0' }}>
              偵測到畫面渲染階段發生例外狀況。請點擊下方按鈕重新載入，或清除暫存狀態以重置至最佳推薦配置。
            </p>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.65rem 1.4rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🔄 重新整理頁面
              </button>
              <button
                type="button"
                onClick={this.handleClearCacheAndReload}
                style={{
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#FCA5A5',
                  border: '1px solid rgba(239, 68, 68, 0.5)',
                  borderRadius: '8px',
                  padding: '0.65rem 1.4rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                🧹 重置配置並重整
              </button>
            </div>
            {this.state.error && (
              <details style={{ marginTop: '1.5rem', textAlign: 'left', background: 'rgba(0,0,0,0.4)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.78rem', color: '#94A3B8' }}>
                <summary style={{ cursor: 'pointer', color: '#F87171', fontWeight: 'bold' }}>錯誤診斷明細 (Debug Stack)</summary>
                <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {this.state.error.toString()}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
