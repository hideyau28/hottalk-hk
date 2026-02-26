import { Receiver } from "https://esm.sh/@upstash/qstash@2.7.17";

let receiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (!receiver) {
    const currentKey = Deno.env.get("QSTASH_CURRENT_SIGNING_KEY");
    const nextKey = Deno.env.get("QSTASH_NEXT_SIGNING_KEY");
    if (!currentKey || !nextKey) {
      throw new Error("Missing QStash signing keys");
    }
    receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey });
  }
  return receiver;
}

export async function verifyQStashSignature(req: Request): Promise<boolean> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return false;

  try {
    const body = await req.clone().text();
    await getReceiver().verify({ signature, body });
    return true;
  } catch {
    return false;
  }
}
