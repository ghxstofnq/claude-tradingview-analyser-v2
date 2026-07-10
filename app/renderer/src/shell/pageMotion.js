// pageMotion — carries the current page's exit state down to the shared <Page>
// frame (motion v1) without threading a prop through all seven page components.
// CommandShell wraps each mounted page with <PageMotionContext.Provider closing>;
// Page reads it to add `.is-closing` so the floating card plays its exit before
// React unmounts it.

import { createContext } from "react";

export const PageMotionContext = createContext({ closing: false });
