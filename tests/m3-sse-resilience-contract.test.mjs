import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const hook = fs.readFileSync(new URL("../lib/admin/use-conversation-stream.ts", import.meta.url), "utf8");
const view = fs.readFileSync(new URL("../app/components/domain-views/m-view.tsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../lib/admin/m-client.ts", import.meta.url), "utf8");
const streamRoute = fs.readFileSync(new URL("../app/api/admin/content/conversations/stream/route.ts", import.meta.url), "utf8");

test("M3 only restores the reconnect budget after a stable stream", () => {
  assert.match(hook, /STABLE_CONNECTION_MS/);
  assert.match(hook, /stableConnectionTimer\s*=\s*window\.setTimeout/);
  assert.match(hook, /reconnectAttempts\s*=\s*0;[\s\S]{0,80}setReconnectExhausted\(false\)/);
  assert.doesNotMatch(hook, /onopen\s*=\s*\(\)\s*=>\s*\{\s*setReady\(true\)/);
  assert.match(hook, /recoveryGate\.complete\([\s\S]{0,500}setReady\(true\)[\s\S]{0,500}reconnectAttempts\s*=\s*0/);
  assert.match(hook, /if \(stableConnectionTimer !== null\) window\.clearTimeout\(stableConnectionTimer\)/);
});

test("M3 reconciles full conversation list/detail before ready and buffers new-stream events", () => {
  assert.match(hook, /onReconnectSnapshotRef\.current\(controller\.signal\)/);
  assert.match(hook, /recoveryGate\.accept\(parsed/);
  assert.match(fs.readFileSync(new URL("../lib/admin/conversation-stream-recovery.ts", import.meta.url), "utf8"), /activeDelivery\.then\(\(\) => deliver\(event\)\)/);
  assert.match(hook, /await recoveryGate\.complete\([\s\S]{0,400}setReady\(true\)/);
  assert.match(view, /fetchMConversationSnapshot\(signal\)/);
  assert.match(view, /onReconnectSnapshot:\s*reconcileConversationSnapshot/);
  assert.match(client, /fetchMConversationSnapshot\(signal\?: AbortSignal\)[\s\S]{0,180}fetchAllSupportConversations\(signal\)/);
  assert.match(client, /fetchMConversationSnapshot\(signal\?: AbortSignal\)[\s\S]{0,500}detailOrUnavailable\(/);
  assert.match(client, /if \(!details\.complete\) throw new Error\("M3_CONVERSATION_DETAILS_UNAVAILABLE"\)/);
  assert.match(client, /const verification = await fetchAllSupportConversations\(signal\)/);
  assert.match(view, /M3_CONVERSATION_SNAPSHOT_SUPERSEDED/);
});

test("M3 probes the stream authority itself and cleans up every reconnect resource", () => {
  assert.match(hook, /fetch\(STREAM_PATH,\s*\{[\s\S]{0,120}method:\s*"HEAD"/);
  assert.match(hook, /isTerminalConversationStreamStatus\(streamStatusResponse\.status\)/);
  assert.match(hook, /recoveryGate\.cancel\(\)/);
  assert.match(hook, /snapshotController\?\.abort\(\)/);
  assert.match(hook, /sessionController\?\.abort\(\)/);
  assert.match(hook, /connectionController\.abort\(\)/);
  assert.match(hook, /onEventRef\.current\(event, connectionController\.signal\)/);
  assert.match(hook, /es\?\.close\(\)/);
  assert.match(streamRoute, /export async function HEAD\(\)/);
  assert.match(streamRoute, /\/api\/admin\/content\/conversations\/stream\/status/);
  assert.match(streamRoute, /status:\s*upstream\.status/);
  assert.match(streamRoute, /signal:\s*request\.signal/);
  assert.match(view, /connectionSignal\.addEventListener\("abort", abortSnapshot/);
  assert.match(view, /if \(connectionSignal\.aborted\) return/);
});

test("M3 exposes reconnect exhaustion and a visible manual recovery", () => {
  assert.match(hook, /const \[reconnectExhausted, setReconnectExhausted\] = useState\(false\)/);
  assert.match(hook, /return \{ ready, reconnectExhausted, retry \}/);
  assert.match(view, /const \{ ready: conversationStreamReady, reconnectExhausted, retry: retryConversationStream \} = useConversationStream/);
  assert.match(view, /实时会话连接已停止自动重试/);
  assert.match(view, /onClick=\{retryConversationStream\}/);
});
