"use client";

import { useEffect, useRef, useState } from "react";
import { LAYER_SHORT } from "@/lib/filter";
import type {
  AskStreamEvent,
  Confidence,
  Hospital,
  Layer,
  ReferencedDocument,
  Trial,
  VerifiedAnswer,
  VerifiedCitation,
} from "@/types";

type RegistryResponse = {
  hospitals: Hospital[];
  trials: Trial[];
  documentCount: number;
  mock: boolean;
};

const CONFIDENCE_STYLE: Record<
  Confidence,
  { label: string; description: string; className: string }
> = {
  grounded: {
    label: "根拠あり",
    description: "資料に明確な根拠がある回答です。",
    className: "bg-emerald-50 text-emerald-900 ring-emerald-600/20",
  },
  ambiguous: {
    label: "解釈の余地あり",
    description:
      "根拠はありますが、条件や例外があり判断の余地が残ります。原文を確認してください。",
    className: "bg-amber-50 text-amber-900 ring-amber-600/30",
  },
  no_evidence: {
    label: "根拠なし",
    description:
      "参照した資料の中に、この質問に答える記述が見つかりませんでした。",
    className: "bg-rose-50 text-rose-900 ring-rose-600/20",
  },
};

const LAYER_BADGE: Record<Layer, string> = {
  1: "bg-slate-100 text-slate-700 ring-slate-500/20",
  2: "bg-sky-50 text-sky-800 ring-sky-600/20",
  3: "bg-violet-50 text-violet-800 ring-violet-600/20",
  4: "bg-teal-50 text-teal-800 ring-teal-600/20",
};

export default function Page() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [hospitalId, setHospitalId] = useState("");
  const [trialId, setTrialId] = useState("");
  const [question, setQuestion] = useState("");

  const [running, setRunning] = useState(false);
  const [documents, setDocuments] = useState<ReferencedDocument[] | null>(null);
  const [streamedText, setStreamedText] = useState("");
  const [answer, setAnswer] = useState<VerifiedAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/registry")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "読み込みに失敗しました");
        return data as RegistryResponse;
      })
      .then(setRegistry)
      .catch((err: Error) => setRegistryError(err.message));
  }, []);

  // 経過秒数の表示。待ち時間が長いので、動いていることを示す。
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const canSubmit =
    Boolean(hospitalId) && Boolean(trialId) && question.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || running) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setDocuments(null);
    setStreamedText("");
    setAnswer(null);
    setError(null);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hospitalId, trialId, question }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `エラーが発生しました (${res.status})`);
      }
      if (!res.body) throw new Error("応答が空でした。");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE のイベント境界は空行
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;

          let event: AskStreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as AskStreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case "meta":
              setDocuments(event.documents);
              break;
            case "answer_delta":
              setStreamedText((prev) => prev + event.text);
              break;
            case "done":
              setAnswer(event.answer);
              break;
            case "error":
              setError(event.message);
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setRunning(false);
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
    setRunning(false);
  }

  // 原文に存在しない引用（捏造の疑い）と、離れた箇所の連結は区別して数える
  const notFoundCount =
    answer?.citations.filter(
      (c) => c.match === "not_found" || c.match === "no_document",
    ).length ?? 0;
  const stitchedCount =
    answer?.citations.filter((c) => c.match === "stitched").length ?? 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          CRC業務支援アプリ
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          病院と治験を選び、業務手順について質問してください。関連する資料のみを参照し、
          根拠となる原文とともに回答します。
        </p>
        {registry?.mock && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/30">
            <strong>モックモード：</strong>
            ANTHROPIC_API_KEY が未設定のため、固定応答を返します。
            .env.local にキーを設定してサーバーを再起動してください。
          </p>
        )}
      </header>

      {registryError && (
        <p className="mb-6 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-600/20">
          {registryError}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Selector
          legend="病院"
          items={registry?.hospitals ?? []}
          value={hospitalId}
          onChange={setHospitalId}
          disabled={running}
        />
        <Selector
          legend="治験"
          items={registry?.trials ?? []}
          value={trialId}
          onChange={setTrialId}
          disabled={running}
        />

        <div>
          <label
            htmlFor="question"
            className="block text-sm font-semibold text-slate-800"
          >
            質問
          </label>
          <textarea
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={running}
            rows={3}
            placeholder="例：治験薬の保管温度が逸脱した場合、どう対応すればよいですか？"
            className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100"
            onKeyDown={(e) => {
              // Ctrl/Cmd + Enter で送信
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (canSubmit && !running) {
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
          />
          <p className="mt-1 text-xs text-slate-500">
            Ctrl（⌘）+ Enter でも送信できます。
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit || running}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {running ? "回答を生成中…" : "質問する"}
          </button>
          {running && (
            <>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                中止
              </button>
              <span className="text-sm tabular-nums text-slate-500">
                {elapsed} 秒
              </span>
            </>
          )}
        </div>
      </form>

      {error && (
        <p className="mt-8 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-600/20">
          {error}
        </p>
      )}

      {documents && <DocumentList documents={documents} />}

      {(streamedText || answer) && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-800">回答</h2>

          {answer && (
            <div
              className={`mt-2 rounded-lg px-3 py-2 text-sm ring-1 ${CONFIDENCE_STYLE[answer.confidence].className}`}
            >
              <strong>{CONFIDENCE_STYLE[answer.confidence].label}</strong>
              <span className="ml-2">
                {CONFIDENCE_STYLE[answer.confidence].description}
              </span>
            </div>
          )}

          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="whitespace-pre-wrap text-slate-900">
              {answer ? answer.answer : streamedText}
              {running && !answer && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-slate-400 align-text-bottom" />
              )}
            </p>
          </div>

          {answer?.caveat && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">留意点</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
                {answer.caveat}
              </p>
            </div>
          )}
        </section>
      )}

      {answer && answer.citations.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">
              出典（{answer.citations.length}件）
            </h2>
            <span className="text-xs font-medium">
              {notFoundCount > 0 && (
                <span className="text-rose-700">
                  {notFoundCount}件が原文に見つかりません
                </span>
              )}
              {notFoundCount > 0 && stitchedCount > 0 && (
                <span className="text-slate-400"> / </span>
              )}
              {stitchedCount > 0 && (
                <span className="text-amber-700">
                  {stitchedCount}件は離れた箇所の連結
                </span>
              )}
            </span>
          </div>
          <ul className="mt-2 space-y-3">
            {answer.citations.map((citation, index) => (
              <CitationCard key={index} citation={citation} />
            ))}
          </ul>
        </section>
      )}

      {answer &&
        answer.citations.length === 0 &&
        answer.confidence !== "no_evidence" && (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-600/20">
            根拠ありとされていますが、出典が示されていません。この回答は信頼できません。
          </p>
        )}
    </main>
  );
}

function Selector({
  legend,
  items,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-slate-800">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.length === 0 && (
          <span className="text-sm text-slate-400">読み込み中…</span>
        )}
        {items.map((item) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(item.id)}
              aria-pressed={selected}
              className={`rounded-full px-4 py-2 text-sm font-medium shadow-sm ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
                selected
                  ? "bg-slate-900 text-white ring-slate-900"
                  : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              {item.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function DocumentList({ documents }: { documents: ReferencedDocument[] }) {
  const totalChars = documents.reduce((sum, d) => sum + d.chars, 0);

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-slate-800">
        参照した資料（{documents.length}件・約
        {totalChars.toLocaleString("ja-JP")}文字）
      </h2>
      <ul className="mt-2 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {documents.map((doc) => (
          <li key={doc.path} className="flex items-start gap-3 px-3 py-2">
            <span
              className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-xs font-medium ring-1 ${LAYER_BADGE[doc.layer]}`}
            >
              {LAYER_SHORT[doc.layer]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-900">{doc.title}</p>
              <p className="truncate text-xs text-slate-500">{doc.path}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MATCH_STYLE: Record<
  VerifiedCitation["match"],
  { label: string; labelClass: string; warning: string | null; warnClass: string }
> = {
  exact: {
    label: "原文と一致",
    labelClass: "text-emerald-700",
    warning: null,
    warnClass: "",
  },
  stitched: {
    label: "離れた箇所を連結",
    labelClass: "text-amber-700",
    warning:
      "引用された各文は原文に存在しますが、原文では連続していません。省略された部分に条件や例外が含まれている可能性があります。原文を確認してください。",
    warnClass: "border-amber-200 bg-amber-50 text-amber-900",
  },
  not_found: {
    label: "原文に該当なし",
    labelClass: "text-rose-700",
    warning:
      "この引用文は原文中に見つかりませんでした。回答が誤っている可能性があります。必ず原文を確認してください。",
    warnClass: "border-rose-200 bg-rose-50 text-rose-900",
  },
  no_document: {
    label: "参照外の文書",
    labelClass: "text-rose-700",
    warning:
      "参照対象に含まれない文書が出典として示されています。この引用は信頼できません。",
    warnClass: "border-rose-200 bg-rose-50 text-rose-900",
  },
};

function CitationCard({ citation }: { citation: VerifiedCitation }) {
  const style = MATCH_STYLE[citation.match];

  return (
    <li className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        {citation.layer && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${LAYER_BADGE[citation.layer]}`}
          >
            {LAYER_SHORT[citation.layer]}
          </span>
        )}
        <span className="text-sm font-medium text-slate-900">
          {citation.documentTitle ?? citation.documentPath}
        </span>
        {citation.location && (
          <span className="text-xs text-slate-600">{citation.location}</span>
        )}
        <span className={`ml-auto text-xs font-medium ${style.labelClass}`}>
          {style.label}
        </span>
      </div>

      {style.warning && (
        <p className={`border-b px-3 py-2 text-xs ${style.warnClass}`}>
          {style.warning}
        </p>
      )}

      <blockquote className="border-l-4 border-slate-300 px-3 py-2">
        <p className="whitespace-pre-wrap text-sm text-slate-800">
          {citation.quote}
        </p>
      </blockquote>

      {citation.relevance && (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
          {citation.relevance}
        </p>
      )}
    </li>
  );
}
