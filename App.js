import ErrorBoundary from "./src/ErrorBoundary";
import Root from "./src/Root";

export default function App() {
  return (
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  );
}
