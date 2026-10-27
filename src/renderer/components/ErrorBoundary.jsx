import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Renderer boundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="panel">
          <h2>Something went wrong</h2>
          <p className="section-note">This view failed to render. Reload the app to reset the renderer state.</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </section>
      );
    }

    return this.props.children;
  }
}
