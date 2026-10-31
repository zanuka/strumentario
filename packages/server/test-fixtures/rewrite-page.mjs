// Rewrites one page in a loop through the built store, from a separate process.
import { FileSystemPageStore } from "../dist/store.js";

const [dir, slug, iterations] = process.argv.slice(2);
const store = new FileSystemPageStore(dir);
for (let i = 0; i < Number(iterations); i += 1) {
  const marker = String(i % 2 === 0 ? "a" : "b");
  await store.put({ title: "Torn read probe", slug, body: marker.repeat(200_000 + i) });
}
