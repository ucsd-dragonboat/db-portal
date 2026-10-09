import QRCode from "qrcode";
import { requireAdmin } from "@/lib/session";

/** Printable QR code pointing at this site's /demo landing page (admins only). */
export async function GET(request: Request) {
  await requireAdmin();
  const target = new URL("/demo", request.url).toString();
  const svg = await QRCode.toString(target, { type: "svg", margin: 2, width: 512, errorCorrectionLevel: "M" });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
