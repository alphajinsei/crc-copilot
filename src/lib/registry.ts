import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import type { DocumentMeta, Registry } from "@/types";

export const DATA_DIR = join(process.cwd(), "data");
const REGISTRY_PATH = join(DATA_DIR, "registry.json");

/**
 * registry.json を読む。開発中は文書を追加・変更しても再起動なしで
 * 反映されるよう、毎回ディスクから読み直す（PoC規模では十分速い）。
 */
export async function loadRegistry(): Promise<Registry> {
  try {
    return JSON.parse(await readFile(REGISTRY_PATH, "utf8")) as Registry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        "data/registry.json が見つかりません。`npm run scan` を実行して生成してください。",
      );
    }
    throw err;
  }
}

/**
 * registry の path を data/ 配下の絶対パスへ解決する。
 *
 * path は registry 由来だが、ディレクトリ外への脱出だけは必ず塞いでおく。
 * 将来 registry の生成経路が変わったときに、ここが最後の砦になる。
 */
function resolveDocumentPath(relativePath: string): string {
  const absolute = normalize(join(DATA_DIR, relativePath));
  if (absolute !== DATA_DIR && !absolute.startsWith(DATA_DIR + sep)) {
    throw new Error(`data/ の外を参照する文書パスです: ${relativePath}`);
  }
  return absolute;
}

export type LoadedDocument = DocumentMeta & { content: string };

/** 文書の本文を読み込む。全文をそのままLLMに渡すため加工はしない。 */
export async function loadDocuments(
  documents: DocumentMeta[],
): Promise<LoadedDocument[]> {
  return Promise.all(
    documents.map(async (doc) => ({
      ...doc,
      content: await readFile(resolveDocumentPath(doc.path), "utf8"),
    })),
  );
}
