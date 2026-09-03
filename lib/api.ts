import { NextResponse } from "next/server";

export const NO_STORE = { "cache-control": "no-store" } as const;

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE });
}

export const unauthorized = () => jsonError("No autenticado", 401);
export const forbidden = () => jsonError("Sin permiso", 403);
export const notFound = () => jsonError("No encontrado", 404);

export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
