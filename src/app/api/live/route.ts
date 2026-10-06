import { getCurrentUser } from "@/lib/dal";
import { handleLive, presenceSnapshot } from "@/lib/multiverse";
import { addClient, removeClient, type LiveClient } from "@/lib/realtime";

// GET: a Server-Sent Events stream of live multiverse events for the signed-in user
//   hello {now}              server clock, so every tab can start the big bang / supernova together
//   mv {id}                  that multiverse changed; reload it
//   presence {mvId, users}   who is inside a multiverse right now, and where they're looking
//   syspresence {hostId, users}  who is in someone's solar system (the host at home, or visitors)
//   nudge / cheer / born / nova
//   goals / social           your goals, or what your connections share, changed (notes, steps, ...)
//   visit {from}             a connection just came to look at your solar system
// POST: a message from the browser (presence, nudge, cheer); see LiveInput in lib/multiverse.ts

const enc = new TextEncoder();

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });

  let client: LiveClient | null = null;
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    if (client) removeClient(client);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          stop();
        }
      };
      client = addClient(me.id, (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`);
      for (const p of presenceSnapshot(me)) write(`event: ${p.event}\ndata: ${JSON.stringify(p.data)}\n\n`);
      // comments keep proxies and the browser from timing the connection out
      ping = setInterval(() => write(": ping\n\n"), 25_000);
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Please sign in again." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad message." }, { status: 400 });
  }
  return Response.json(await handleLive(me, body));
}
