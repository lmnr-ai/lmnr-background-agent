import { NextResponse } from "next/server";
import { getAllMessages } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const messages = getAllMessages();
  return NextResponse.json(messages);
}
