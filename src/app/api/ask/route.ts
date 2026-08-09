import { askClaude, askMock, getModel, isMockMode } from "@/lib/anthropic";
import { selectDocuments, sortByLayer } from "@/lib/filter";
import { loadDocuments, loadRegistry } from "@/lib/registry";
import { verifyAnswer } from "@/lib/verify";
import type { AskStreamEvent, ReferencedDocument } from "@/types";

export const dynamic = "force-dynamic";
/** 全文投入のため応答に時間がかかる。Node ランタイムで長めに確保する。 */
export const maxDuration = 300;

type AskRequest = {
  hospitalId?: unknown;
  trialId?: unknown;
  question?: unknown;
};

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: AskRequest;
  try {
    body = (await request.json()) as AskRequest;
  } catch {
    return errorResponse("リクエストの形式が不正です。", 400);
  }

  const hospitalId = typeof body.hospitalId === "string" ? body.hospitalId : "";
  const trialId = typeof body.trialId === "string" ? body.trialId : "";
  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  if (!hospitalId || !trialId) {
    return errorResponse("病院と治験を選択してください。", 400);
  }
  if (!question) {
    return errorResponse("質問を入力してください。", 400);
  }
  if (question.length > 2000) {
    return errorResponse("質問が長すぎます（2000文字以内）。", 400);
  }

  let registry;
  try {
    registry = await loadRegistry();
  } catch (err) {
    return errorResponse(
      err instanceof Error ? err.message : String(err),
      500,
    );
  }

  const hospital = registry.hospitals.find((h) => h.id === hospitalId);
  const trial = registry.trials.find((t) => t.id === trialId);
  if (!hospital) return errorResponse("指定された病院が存在しません。", 400);
  if (!trial) return errorResponse("指定された治験が存在しません。", 400);

  // 本アプリの根幹。決定的ロジックで対象文書を確定させる。
  const selected = sortByLayer(
    selectDocuments(registry.documents, hospitalId, trialId),
  );
  if (selected.length === 0) {
    return errorResponse(
      "この組み合わせに関連する文書が1件も見つかりませんでした。",
      404,
    );
  }

  let documents;
  try {
    documents = await loadDocuments(selected);
  } catch (err) {
    return errorResponse(
      `文書の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      500,
    );
  }

  const referenced: ReferencedDocument[] = documents.map((doc) => ({
    path: doc.path,
    title: doc.title,
    layer: doc.layer,
    docType: doc.docType,
    chars: doc.content.length,
  }));

  const encoder = new TextEncoder();
  const mock = isMockMode();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AskStreamEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        // 参照文書はLLMの応答を待たずに先に返す。CRCは待っている間に
        // 「何が参照されているか」を確認できる。
        send({
          type: "meta",
          hospital,
          trial,
          documents: referenced,
          mock,
          model: mock ? "(mock)" : getModel(),
          estimatedInputChars: documents.reduce(
            (sum, d) => sum + d.content.length,
            0,
          ),
        });

        const callbacks = {
          onAnswerDelta: (text: string) =>
            send({ type: "answer_delta", text }),
        };

        const answer = mock
          ? await askMock(documents, question, callbacks)
          : await askClaude(
              hospital,
              trial,
              documents,
              question,
              callbacks,
              request.signal,
            );

        send({ type: "done", answer: verifyAnswer(answer, documents) });
      } catch (err) {
        // クライアントが離脱しただけならエラー送信は不要
        if (!request.signal.aborted) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx等のリバースプロキシでのバッファリングを抑止する
      "x-accel-buffering": "no",
    },
  });
}
