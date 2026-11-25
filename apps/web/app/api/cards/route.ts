import { indexerHandlers } from "@/lib/indexer/defaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => indexerHandlers().cards(req);
