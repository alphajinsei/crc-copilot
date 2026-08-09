/**
 * data/ 配下のフォルダ構造をスキャンして data/registry.json を生成する。
 *
 * 命名規約（docs/design.md 4.3 を参照）
 *   01_gcp/                          → 層①
 *   02_hospital/{病院ID}_{表示名}/     → 層②
 *   03_trial/{治験ID}_{表示名}/        → 層③
 *   04_hospital_trial/{病院ID}__{治験ID}/ → 層④（アンダースコア2つ区切り）
 *
 * 実行: npm run scan
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = join(ROOT, "data");
const REGISTRY_PATH = join(DATA_DIR, "registry.json");

const HOSPITAL_ID = /^H\d{3}$/;
const TRIAL_ID = /^T\d{3}$/;

/** ファイル名から文書種別を推定する。registry の docType になる。 */
const DOC_TYPES = {
  "gcp-ordinance": "gcp",
  "hosp-sop": "hosp_sop",
  "pharmacy-sop": "pharmacy_sop",
  "laboratory-sop": "laboratory_sop",
  "nursing-sop": "nursing_sop",
  protocol: "protocol",
  "investigators-brochure": "investigators_brochure",
  "informed-consent": "informed_consent",
  "lab-manual": "lab_manual",
  "drug-handling": "drug_handling",
  "specific-sop": "specific_sop",
  "note-to-file": "note_to_file",
  "pharmacist-meeting-minutes": "pharmacist_meeting_minutes",
};

const errors = [];

/** 指定ディレクトリ直下のサブディレクトリ名を返す。存在しなければ空配列。 */
async function subdirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/** 指定ディレクトリ直下の .md ファイル名を返す。存在しなければ空配列。 */
async function markdownFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Markdown の先頭の見出し（# ...）をタイトルとして取り出す。
 * 見出しがなければファイル名を返す。
 */
async function extractTitle(absPath, fallback) {
  const text = await readFile(absPath, "utf8");
  const match = text.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

/** registry に載せる path は data/ からの相対 + スラッシュ区切りに正規化する。 */
function toRegistryPath(absPath) {
  return relative(DATA_DIR, absPath).split(sep).join("/");
}

function docTypeOf(fileName) {
  const base = fileName.replace(/\.md$/, "");
  return DOC_TYPES[base] ?? base.replace(/-/g, "_");
}

/** 1ファイル分の文書メタデータを組み立てる。 */
async function buildDocument(absPath, fileName, layer, hospitalId, trialId) {
  return {
    path: toRegistryPath(absPath),
    layer,
    hospitalId,
    trialId,
    title: await extractTitle(absPath, fileName),
    docType: docTypeOf(fileName),
  };
}

async function scanLayer1(documents) {
  const dir = join(DATA_DIR, "01_gcp");
  for (const file of await markdownFiles(dir)) {
    documents.push(
      await buildDocument(join(dir, file), file, 1, null, null),
    );
  }
}

async function scanLayer2(documents, hospitals) {
  const base = join(DATA_DIR, "02_hospital");
  for (const folder of (await subdirs(base)).sort()) {
    const sepIndex = folder.indexOf("_");
    const id = sepIndex === -1 ? folder : folder.slice(0, sepIndex);
    const name = sepIndex === -1 ? "" : folder.slice(sepIndex + 1);

    if (!HOSPITAL_ID.test(id)) {
      errors.push(
        `02_hospital/${folder}: 病院IDが規約（H+3桁）に合致しません`,
      );
      continue;
    }
    if (!name) {
      errors.push(`02_hospital/${folder}: 表示名がありません（{ID}_{表示名}）`);
      continue;
    }
    hospitals.set(id, name);

    const dir = join(base, folder);
    for (const file of await markdownFiles(dir)) {
      documents.push(await buildDocument(join(dir, file), file, 2, id, null));
    }
  }
}

async function scanLayer3(documents, trials) {
  const base = join(DATA_DIR, "03_trial");
  for (const folder of (await subdirs(base)).sort()) {
    const sepIndex = folder.indexOf("_");
    const id = sepIndex === -1 ? folder : folder.slice(0, sepIndex);
    const name = sepIndex === -1 ? "" : folder.slice(sepIndex + 1);

    if (!TRIAL_ID.test(id)) {
      errors.push(`03_trial/${folder}: 治験IDが規約（T+3桁）に合致しません`);
      continue;
    }
    if (!name) {
      errors.push(`03_trial/${folder}: 表示名がありません（{ID}_{表示名}）`);
      continue;
    }
    trials.set(id, name);

    const dir = join(base, folder);
    for (const file of await markdownFiles(dir)) {
      documents.push(await buildDocument(join(dir, file), file, 3, null, id));
    }
  }
}

async function scanLayer4(documents, hospitals, trials) {
  const base = join(DATA_DIR, "04_hospital_trial");
  for (const folder of (await subdirs(base)).sort()) {
    const parts = folder.split("__");
    if (parts.length !== 2) {
      errors.push(
        `04_hospital_trial/${folder}: {病院ID}__{治験ID} の形式ではありません（アンダースコア2つ区切り）`,
      );
      continue;
    }
    const [hospitalId, trialId] = parts;
    if (!HOSPITAL_ID.test(hospitalId) || !TRIAL_ID.test(trialId)) {
      errors.push(`04_hospital_trial/${folder}: IDが規約に合致しません`);
      continue;
    }
    // 層④は層②③に実体があってはじめて成立する。孤児フォルダは絞り込みから漏れるため検出する。
    if (!hospitals.has(hospitalId)) {
      errors.push(
        `04_hospital_trial/${folder}: 病院ID ${hospitalId} が 02_hospital に存在しません`,
      );
    }
    if (!trials.has(trialId)) {
      errors.push(
        `04_hospital_trial/${folder}: 治験ID ${trialId} が 03_trial に存在しません`,
      );
    }

    const dir = join(base, folder);
    for (const file of await markdownFiles(dir)) {
      documents.push(
        await buildDocument(join(dir, file), file, 4, hospitalId, trialId),
      );
    }
  }
}

async function main() {
  const documents = [];
  const hospitals = new Map();
  const trials = new Map();

  await scanLayer1(documents);
  await scanLayer2(documents, hospitals);
  await scanLayer3(documents, trials);
  await scanLayer4(documents, hospitals, trials);

  if (errors.length > 0) {
    console.error("命名規約に違反するフォルダがあります:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      "\n規約は docs/design.md 4.3 を参照してください。処理を中止します。",
    );
    process.exit(1);
  }

  const registry = {
    generatedAt: new Date().toISOString(),
    hospitals: [...hospitals].map(([id, name]) => ({ id, name })),
    trials: [...trials].map(([id, name]) => ({ id, name })),
    documents,
  };

  await writeFile(
    REGISTRY_PATH,
    JSON.stringify(registry, null, 2) + "\n",
    "utf8",
  );

  const byLayer = documents.reduce((acc, d) => {
    acc[d.layer] = (acc[d.layer] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`registry.json を生成しました: ${toRegistryPath(REGISTRY_PATH)}`);
  console.log(`  病院: ${registry.hospitals.length}件`);
  console.log(`  治験: ${registry.trials.length}件`);
  console.log(
    `  文書: ${documents.length}件` +
      ` (①${byLayer[1] ?? 0} / ②${byLayer[2] ?? 0} / ③${byLayer[3] ?? 0} / ④${byLayer[4] ?? 0})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
