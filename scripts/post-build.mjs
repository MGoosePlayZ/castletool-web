// After `vite build`: tell GitHub Pages not to run Jekyll, and make unknown paths load the app.
import { copyFileSync, writeFileSync } from "node:fs";
writeFileSync("docs/.nojekyll", "");
copyFileSync("docs/index.html", "docs/404.html");
