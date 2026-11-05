import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { MetaProvider, Title } from "@solidjs/meta";
import { Suspense } from "solid-js";
import "./styles.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <Title>LastZ · Fieldwork</Title>
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
