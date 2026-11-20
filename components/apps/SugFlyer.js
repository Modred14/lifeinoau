// components/apps/SugFlyer.js: "Generate Campaign Flyer" for a candidate (any category: university, SUG or faculty).
// The picture goes up, the SERVER draws the flyer from the account's own name and the registered post (lib/sugFlyer.js), and this screen only shows,
// downloads and shares the PNG it gets back. Nothing on this screen chooses the username or the position: it displays what the server says.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import Loader from "@/components/Loader";
import { Icon } from "../Icon";

const API = "/api/sug/flyer", MAX_SIDE = 1600;

async function json(res) { try { return await res.json(); } catch { return {}; } }

/** Shrinks a chosen picture to at most 1600 px and re-encodes it as JPEG in the browser (this also applies the phone's rotation), so uploads stay small and upright. */
async function prepare(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP photograph.");
  let bmp; try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("That picture could not be read. Try another one."); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  if (Math.min(bmp.width, bmp.height) < 300) throw new Error("That picture is too small. Use one at least 300 pixels wide and tall.");
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("That picture could not be prepared. Try another one.");
  return blob;
}

export default function SugFlyer({ onClose }) {
  const [st, setSt] = useState(null), [err, setErr] = useState(""), [busy, setBusy] = useState(""), [img, setImg] = useState(null), [name, setName] = useState("lifeinoau-flyer.png");
  const file = useRef(null), blobRef = useRef(null);

  const setUrl = useCallback((blob) => { setImg((old) => { if (old) URL.revokeObjectURL(old); return blob ? URL.createObjectURL(blob) : null; }); blobRef.current = blob; }, []);
  useEffect(() => () => { setImg((old) => { if (old) URL.revokeObjectURL(old); return null; }); }, []);

  const draw = useCallback(async () => {
    setBusy("Drawing your flyer…"); setErr("");
    try {
      const res = await fetch(`${API}?t=${Date.now()}`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error((await json(res)).error || "Could not draw the flyer.");
      const cd = res.headers.get("content-disposition") ?? "", m = /filename="([^"]+)"/.exec(cd); if (m) setName(m[1]);
      setUrl(await res.blob());
    } catch (e) { setErr(e.message); } finally { setBusy(""); }
  }, [setUrl]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}?view=state`, { credentials: "same-origin", cache: "no-store" }), d = await json(res);
      if (!res.ok) throw new Error(d.error || "Could not open the flyer maker.");
      setSt(d); if (d.hasPhoto) await draw();
    } catch (e) { setErr(e.message); setSt((s) => s ?? { failed: true }); }
  }, [draw]);
  useEffect(() => { load(); }, [load]);

  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setBusy("Uploading your picture…"); setErr("");
    try {
      const body = await prepare(f);
      const res = await fetch(API, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "image/jpeg" }, body }), d = await json(res);
      if (!res.ok) throw new Error(d.error || "The picture was not accepted.");
      setSt(d); toast.success("Picture saved."); await draw();
    } catch (er) { setErr(er.message); setBusy(""); }
  }

  function download() {
    if (!img) return;
    const a = document.createElement("a"); a.href = img; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  async function share() {
    const blob = blobRef.current; if (!blob || !st) return;
    const f = new File([blob], name, { type: "image/png" }), data = { files: [f], title: "My LifeinOAU campaign flyer", text: st.shareText };
    try {
      if (navigator.canShare?.(data)) { await navigator.share(data); return; }
      if (navigator.share) { await navigator.share({ title: data.title, text: st.shareText, url: "https://lifeinoau.com" }); return; }
    } catch (e) { if (e?.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(st.shareText); toast.success("Sharing is not available here, so your campaign message was copied. Download the flyer to post it."); } catch { download(); }
  }

  return (
    <div className="sg-sheet" role="dialog" aria-label="Campaign flyer">
      <div className="sg-sheet-in sg-flyer">
        <header><h3>Campaign flyer</h3><button type="button" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></header>
        {!st ? <Loader label="Opening the flyer maker" /> : st.failed ? <p className="sg-hint" role="alert">{err || "The flyer maker could not open."}</p> : (
          <>
            <div className="sg-card">
              <small>Your flyer will say</small>
              <b className="sg-fl-msg">VOTE FOR @{st.username.toUpperCase()} AS {st.positionTitle.toUpperCase()} ON LIFEINOAU</b>
              {st.faculty ? <small>{st.faculty}</small> : null}
              <p className="sg-hint">Your username and position come from your account and your registration. They cannot be changed here.</p>
            </div>
            <div className="sg-fl-frame" aria-busy={!!busy}>
              {img ? <img src={img} alt={`Campaign flyer: vote for @${st.username} as ${st.positionTitle} on LifeinOAU`} /> : <div className="sg-fl-empty">{busy || (st.hasPhoto ? "Your flyer will appear here." : "Add your picture to make your flyer.")}</div>}
              {img && busy ? <div className="sg-fl-busy">{busy}</div> : null}
            </div>
            {err ? <p className="sg-hint sg-fl-err" role="alert">{err}</p> : null}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
            {!st.hasPhoto ? (
              <button type="button" className="go" disabled={!!busy} onClick={() => file.current?.click()}>{busy || "Upload your picture"}</button>
            ) : (
              <div className="sg-fl-actions">
                <button type="button" className="go" disabled={!img || !!busy} onClick={download}>Download image</button>
                <button type="button" disabled={!img || !!busy} onClick={share}>Share</button>
                <button type="button" disabled={!!busy} onClick={draw}>Regenerate</button>
                <button type="button" disabled={!!busy} onClick={() => file.current?.click()}>Change picture</button>
              </div>
            )}
            <p className="sg-hint">A clear, front-facing photograph of you works best (JPEG, PNG or WebP). Your picture is used only for your flyer.</p>
          </>
        )}
      </div>
    </div>
  );
}
