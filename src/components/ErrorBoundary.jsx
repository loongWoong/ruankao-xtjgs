import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container">
          <div className="empty-state" style={{ padding: '3rem' }}>
            <div className="empty-state-icon" style={{ fontSize: '3rem' }}>⚠️</div>
            <h2 style={{ color: '#f44336', marginTop: '1rem' }}>页面加载出错了</h2>
            <p style={{ color: '#666', marginTop: '0.5rem' }}>
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
              className="btn btn-primary"
              style={{ marginTop: '1.5rem' }}
              onClick={this.handleRetry}
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
