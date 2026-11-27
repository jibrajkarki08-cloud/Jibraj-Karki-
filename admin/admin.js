(() => {
"use strict";
const C = window.ADMIN_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- config safety ---------- */
function looksSecret(k) {
  if (/^sb_secret_/.test(k)) return true;
  try { return JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch { return false; }
}
if (!C.SUPABASE_URL || !C.SUPABASE_KEY || /YOUR_/.test(C.SUPABASE_URL + C.SUPABASE_KEY) || looksSecret(C.SUPABASE_KEY)) {
  document.body.innerHTML = '<div class="setup"><h2>Setup needed</h2><p>Open <b>admin/config.js</b> and set your Supabase Project URL and Publishable key. Never use a service_role or secret key.</p></div>';
  return;
}
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

/* ---------- table definitions (exact column names from 01_schema.sql) ---------- */
const SEO = [["seo_title", "SEO title", "text", { max: 70 }], ["meta_description", "Meta description", "textarea", { max: 170, rows: 2, w: 1 }]];
const SRC = ["source_url", "Official source URL", "url", { max: 500 }];
const PDF = ["pdf_path", "Official PDF", "pdf", { w: 1 }];
const TITLE = ["title", "Title", "text", { req: 1, min: 5, max: 200, w: 1 }];
const SLUG = ["slug", "Slug (URL)", "slug", { max: 120, hint: "Leave empty to create it from the title." }];
const CAT = ["category_id", "Category", "cat"];
const T = {
  vacancies: { label: "Vacancies", one: "vacancy", cat: "vacancy", cols: ["organization", "position", "deadline"], search: ["title", "organization", "position"],
    fields: [TITLE, SLUG, ["organization", "Organization", "text", { req: 1, max: 160 }], ["position", "Position", "text", { req: 1, max: 160 }], CAT,
      ["advertisement_no", "Advertisement number", "text", { max: 80 }], ["opening_date", "Application opening date", "date"], ["deadline", "Application deadline", "date"],
      ["description", "Vacancy description", "textarea", { rows: 6, w: 1 }], ["qualifications", "Required qualifications", "textarea", { rows: 5, max: 10000, w: 1 }],
      PDF, SRC, ["featured_image_path", "Featured image", "image", { w: 1 }], ...SEO] },
  notices: { label: "Notices", one: "notice", cat: "notice", cols: ["organization", "publication_date"], search: ["title", "organization"],
    fields: [TITLE, SLUG, ["organization", "Organization", "text", { max: 160 }], CAT, ["publication_date", "Publication date", "date", { req: 1, nn: 1, def: "today" }],
      ["description", "Description", "textarea", { rows: 6, w: 1 }], PDF, SRC, ...SEO] },
  syllabuses: { label: "Syllabus", one: "syllabus", cat: "syllabus", cols: ["organization", "exam_level"], search: ["title", "organization", "position"],
    fields: [TITLE, SLUG, ["organization", "Organization", "text", { req: 1, max: 160 }], ["position", "Position", "text", { max: 160 }], ["exam_level", "Exam level", "text", { max: 120 }], CAT,
      ["description", "Description", "textarea", { rows: 6, w: 1 }], PDF, SRC, ...SEO] },
  results: { label: "Results", one: "result", cat: "result", cols: ["result_type", "organization", "publication_date"], search: ["title", "organization", "position"],
    fields: [TITLE, SLUG, ["result_type", "Result type", "rtype", { req: 1 }], ["organization", "Organization", "text", { req: 1, max: 160 }], ["position", "Position", "text", { max: 160 }],
      ["advertisement_no", "Advertisement number", "text", { max: 80 }], CAT, ["publication_date", "Publication date", "date", { req: 1, nn: 1, def: "today" }],
      ["description", "Description", "textarea", { rows: 5, w: 1 }], PDF, SRC, ...SEO] },
  blogs: { label: "Blogs", one: "blog post", cat: "blog", cols: ["author_name"], search: ["title"],
    fields: [TITLE, SLUG, ["excerpt", "Short excerpt", "textarea", { rows: 2, max: 400, w: 1 }], CAT, ["author_name", "Author", "text", { req: 1, nn: 1, def: "Jibraj Karki", max: 120 }],
      ["content", "Content", "rich", { w: 1 }], ["featured_image_path", "Featured image", "image", { w: 1 }], ...SEO] }
};
const UPLOAD = {
  pdf:   { bucket: "documents", types: { "application/pdf": "pdf" }, max: 10 * 1048576, accept: "application/pdf", name: "PDF (max 10 MB)" },
  image: { bucket: "images", types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }, max: 3 * 1048576, accept: "image/jpeg,image/png,image/webp", name: "JPG, PNG or WebP (max 3 MB)" }
};
const PER = 15, UUID = /^[0-9a-f-]{36}$/i;
const today = () => new Date().toISOString().slice(0, 10);
const pubUrl = (b, p) => sb.storage.from(b).getPublicUrl(p).data.publicUrl;
const bucketOf = ty => UPLOAD[ty].bucket;
let CATS = [];
const view = $("#view");

function toast(m, t = "ok") { const e = document.createElement("div"); e.className = "toast " + t; e.textContent = m; $("#toast").append(e); setTimeout(() => e.remove(), 4500); }
const errBox = e => `<div class="empty">Error: ${esc(e.message || e)}</div>`;
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

/* ---------- auth ---------- */
function showLogin(msg = "") {
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#recovery").hidden = true;
  view.innerHTML = "";
  $("#lerr").textContent = msg;
  $("#pw").value = "";
}

function showRecovery() {
  $("#app").hidden = true;
  $("#login").hidden = true;
  $("#recovery").hidden = false;
}
  const { data: ok } = await sb.rpc("is_admin");
  if (ok !== true) { await sb.auth.signOut(); return showLogin("This account is not an authorized admin."); }
  const { data } = await sb.from("categories").select("id,name,type").order("sort_order");
  CATS = data || [];
  $("#who").textContent = session.user.email;
  $("#login").hidden = true; $("#app").hidden = false;
  route();
}
$("#lf").addEventListener("submit", async e => {
  e.preventDefault();
  const b = $("#lf .btn"); b.disabled = true; $("#lerr").textContent = "";
  const { data, error } = await sb.auth.signInWithPassword({ email: $("#em").value.trim(), password: $("#pw").value });
  b.disabled = false;
  if (error || !data.session) return ($("#lerr").textContent = "Invalid email or password.");
  await enter(data.session);
});
$("#out").addEventListener("click", async () => { await sb.auth.signOut(); showLogin(); });
$("#forgot").addEventListener("click", async () => {
  const email = $("#em").value.trim();

  if (!email) {
    $("#lerr").textContent = "Please enter your admin email first.";
    return;
  }

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  $("#lerr").textContent = error
    ? error.message
    : "Password reset email sent. Check your inbox.";
});

$("#rf").addEventListener("submit", async e => {
  e.preventDefault();

  const p1 = $("#rpw").value;
  const p2 = $("#rpw2").value;

  if (p1.length < 8) {
    $("#rerr").textContent = "Password must be at least 8 characters.";
    return;
  }

  if (p1 !== p2) {
    $("#rerr").textContent = "Passwords do not match.";
    return;
  }

  const { error } = await sb.auth.updateUser({ password: p1 });

  if (error) {
    $("#rerr").textContent = error.message;
    return;
  }

  await sb.auth.signOut();
  showLogin("Password updated successfully. Please sign in.");
});
sb.auth.onAuthStateChange(ev => {
  if (ev === "PASSWORD_RECOVERY") {
    showRecovery();
  }

  if (ev === "SIGNED_OUT") {
    showLogin();
  }
});
$("#burger").addEventListener("click", () => $("#side").classList.toggle("open"));
$("#nav").addEventListener("click", () => $("#side").classList.remove("open"));

/* ---------- router ---------- */
function route() {
  const [k, a, id] = location.hash.slice(1).split("/");
  const key = k || "dashboard";
  document.querySelectorAll("#nav a").forEach(x => x.classList.toggle("on", x.dataset.k === key));
  $("#title").textContent = key === "dashboard" ? "Dashboard" : key === "media" ? "Media library" : (T[key]?.label || "");
  if (key === "dashboard") return vDashboard();
  if (key === "media") return vMedia();
  if (!T[key]) return (location.hash = "#dashboard");
  if (a === "new") return vForm(key);
  if (a === "edit" && UUID.test(id || "")) return vForm(key, id);
  vList(key);
}
addEventListener("hashchange", () => { if (!$("#app").hidden) route(); });

/* ---------- dashboard ---------- */
async function vDashboard() {
  view.innerHTML = '<p class="muted">Loading…</p>';
  const { data, error } = await sb.rpc("admin_dashboard_stats");
  if (error) return (view.innerHTML = errBox(error));
  view.innerHTML = '<div class="cards">' + Object.keys(T).map(k => { const s = data[k] || {};
    return `<a class="stat" href="#${k}"><span>${T[k].label}</span><strong>${s.total ?? 0}</strong><small>${s.published ?? 0} published · ${s.draft ?? 0} draft</small></a>`; }).join("") + "</div>" +
    '<h2 style="margin-bottom:12px">Quick add</h2><div class="row">' + Object.keys(T).map(k => `<a class="btn ghost" href="#${k}/new">+ ${esc(T[k].one)}</a>`).join("") + "</div>";
}

/* ---------- list ---------- */
const S = {};
async function vList(k) {
  const t = T[k], s = (S[k] ||= { page: 1, q: "", status: "", cat: "" });
  view.innerHTML = `<div class="bar"><input id="q" type="search" placeholder="Search…" value="${esc(s.q)}" aria-label="Search">
    <select id="fs" aria-label="Status"><option value="">All statuses</option><option value="published"${s.status === "published" ? " selected" : ""}>Published</option><option value="draft"${s.status === "draft" ? " selected" : ""}>Draft</option></select>
    <select id="fc" aria-label="Category"><option value="">All categories</option>${CATS.filter(c => c.type === t.cat).map(c => `<option value="${c.id}"${s.cat === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <a class="btn" href="#${k}/new">+ Add ${esc(t.one)}</a></div><div id="tbl" class="box"><p class="empty">Loading…</p></div><div id="pg" class="pager"></div>`;
  let timer;
  $("#q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => { s.q = e.target.value; s.page = 1; load(); }, 350); });
  $("#fs").addEventListener("change", e => { s.status = e.target.value; s.page = 1; load(); });
  $("#fc").addEventListener("change", e => { s.cat = e.target.value; s.page = 1; load(); });
  $("#tbl").addEventListener("click", async e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const { act, id, title, status } = b.dataset;
    if (act === "toggle") {
      const { error } = await sb.from(k).update({ status: status === "published" ? "draft" : "published" }).eq("id", id);
      error ? toast(error.message, "bad") : (toast(status === "published" ? "Moved to draft" : "Published"), load());
    } else if (act === "del") {
      if (!confirm(`Delete "${title}"?\nThis cannot be undone.`)) return;
      const { error } = await sb.from(k).delete().eq("id", id);
      error ? toast(error.message, "bad") : (toast("Deleted"), load());
    }
  });
  load();

  async function load() {
    let q = sb.from(k).select(["id", "title", "status", "updated_at", ...t.cols].join(","), { count: "exact" })
      .order("updated_at", { ascending: false }).range((s.page - 1) * PER, s.page * PER - 1);
    if (s.status) q = q.eq("status", s.status);
    if (s.cat) q = q.eq("category_id", s.cat);
    const term = s.q.replace(/[,()%*\\"']/g, " ").trim();
    if (term) q = q.or(t.search.map(c => `${c}.ilike.%${term}%`).join(","));
    const { data, error, count } = await q;
    if (error) return ($("#tbl").innerHTML = errBox(error));
    if (!data.length) { $("#tbl").innerHTML = '<p class="empty">Nothing found.</p>'; $("#pg").innerHTML = ""; return; }
    const head = t.cols.map(c => `<th>${esc(c.replace(/_/g, " "))}</th>`).join("");
    $("#tbl").innerHTML = `<table><thead><tr><th>Title</th>${head}<th>Status</th><th>Updated</th><th></th></tr></thead><tbody>` + data.map(r => {
      const exp = k === "vacancies" && r.deadline && r.deadline < today() ? ' <span class="badge exp">Expired</span>' : "";
      return `<tr><td class="t">${esc(r.title)}${exp}</td>${t.cols.map(c => `<td>${esc(r[c] ?? "")}</td>`).join("")}
        <td><span class="badge ${r.status === "published" ? "pub" : ""}">${esc(r.status)}</span></td><td>${esc((r.updated_at || "").slice(0, 10))}</td>
        <td class="a"><a class="btn sm ghost" href="#${k}/edit/${r.id}">Edit</a>
        <button class="btn sm ghost" data-act="toggle" data-id="${r.id}" data-status="${r.status}">${r.status === "published" ? "Unpublish" : "Publish"}</button>
        <button class="btn sm dangerg" data-act="del" data-id="${r.id}" data-title="${esc(r.title)}">Delete</button></td></tr>`; }).join("") + "</tbody></table>";
    const pages = Math.max(1, Math.ceil(count / PER));
    $("#pg").innerHTML = `<span class="muted">${count} item${count === 1 ? "" : "s"} · page ${s.page} of ${pages}</span><span class="row"><button class="btn sm ghost" id="pv" ${s.page <= 1 ? "disabled" : ""}>Previous</button><button class="btn sm ghost" id="nx" ${s.page >= pages ? "disabled" : ""}>Next</button></span>`;
    $("#pv").onclick = () => { s.page--; load(); };
    $("#nx").onclick = () => { s.page++; load(); };
  }
}

/* ---------- upload ---------- */
/* ---------- upload ---------- */
async function upload(kind, file, folder) {
  const u = UPLOAD[kind];
  const ext = u.types[file.type];

  if (!ext) {
    throw new Error("Wrong file type. Allowed: " + u.name);
  }

  if (file.size > u.max) {
    throw new Error("File is too large. Allowed: " + u.name);
  }

  if (
    kind === "pdf" &&
    new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== "%PDF-"
  ) {
    throw new Error("This is not a valid PDF file.");
  }

  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from(u.bucket)
    .upload(path, file, {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) throw uploadError;

  const { error: mediaError } = await sb
    .from("media")
    .insert({
      bucket: u.bucket,
      path: path,
      original_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size
    });

  if (mediaError) {
    const { error: cleanupError } = await sb.storage
      .from(u.bucket)
      .remove([path]);

    if (cleanupError) {
      throw new Error(
        "Database error: " + mediaError.message +
        ". File cleanup error: " + cleanupError.message
      );
    }

    throw new Error("Media save failed: " + mediaError.message);
  }

  return path;
}
const fileStatus = (kind, p) => p ? `<a href="${esc(pubUrl(bucketOf(kind), p))}" target="_blank" rel="noopener">View current file</a>` : "No file attached";

/* ---------- add / edit form ---------- */
async function vForm(k, id) {
  const t = T[k]; let row = {};
  view.innerHTML = '<p class="muted">Loading…</p>';
  if (id) {
    const { data, error } = await sb.from(k).select("*").eq("id", id).single();
    if (error) return (view.innerHTML = errBox(error));
    row = data;
  }
  $("#title").textContent = (id ? "Edit " : "Add ") + t.one;
  const field = ([n, l, ty, o = {}]) => {
    const v = row[n] ?? (o.def === "today" ? today() : o.def || ""), fid = "f_" + n, req = o.req ? " required" : "";
    let inp;
    if (ty === "textarea") inp = `<textarea id="${fid}" name="${n}" rows="${o.rows || 4}" maxlength="${o.max || 20000}"${req}>${esc(v)}</textarea>`;
    else if (ty === "cat") inp = `<select id="${fid}" name="${n}"><option value="">None</option>${CATS.filter(c => c.type === t.cat).map(c => `<option value="${c.id}"${c.id === v ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`;
    else if (ty === "rtype") inp = `<select id="${fid}" name="${n}" required>${[["written", "Written exam"], ["interview", "Interview"], ["final", "Final"]].map(([a, b]) => `<option value="${a}"${a === v ? " selected" : ""}>${b}</option>`).join("")}</select>`;
    else if (ty === "pdf" || ty === "image") inp = `<div class="up" data-kind="${ty}"><input type="hidden" name="${n}" value="${esc(v)}"><input type="file" id="${fid}" accept="${UPLOAD[ty].accept}"><div class="upst">${fileStatus(ty, v)}</div><button type="button" class="btn sm dangerg rm">Remove file</button></div><div class="hint">${UPLOAD[ty].name}</div>`;
    else if (ty === "rich") inp = '<div id="ed"></div>';
    else inp = `<input id="${fid}" name="${n}" type="${ty === "slug" ? "text" : ty}" value="${esc(v)}" maxlength="${o.max || 200}"${o.min ? ` minlength="${o.min}"` : ""}${req}${ty === "slug" ? ' pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="auto-generated"' : ""}>`;
    return `<div class="fld${o.w ? " w" : ""}"><label for="${fid}">${l}${o.req ? " *" : ""}</label>${inp}${o.hint ? `<div class="hint">${o.hint}</div>` : ""}</div>`;
  };
  view.innerHTML = `<form id="f" class="form" novalidate>${t.fields.map(field).join("")}
    <div class="acts"><div><label for="st">Status</label><select id="st" name="status"><option value="draft"${row.status !== "published" ? " selected" : ""}>Draft</option><option value="published"${row.status === "published" ? " selected" : ""}>Published</option></select></div>
    <button class="btn" type="submit">Save</button><a class="btn ghost" href="#${k}">Cancel</a><span id="ferr" class="err" role="alert"></span></div></form>`;

  let quill = null;
  if (t.fields.some(f => f[2] === "rich")) {
    quill = new Quill("#ed", { theme: "snow", modules: { toolbar: [[{ header: [2, 3, false] }], ["bold", "italic", "underline"], [{ list: "ordered" }, { list: "bullet" }], ["blockquote", "link"], ["clean"]] } });
    quill.clipboard.dangerouslyPasteHTML(DOMPurify.sanitize(row.content || ""));
  }
  const form = $("#f");
  form.querySelectorAll(".up").forEach(box => {
    const kind = box.dataset.kind, hid = box.querySelector("input[type=hidden]"), st = box.querySelector(".upst");
    box.querySelector("input[type=file]").addEventListener("change", async e => {
      const file = e.target.files[0]; if (!file) return;
      const sub = $(".acts .btn"); sub.disabled = true; st.textContent = "Uploading…";
      try { hid.value = await upload(kind, file, k); st.innerHTML = "Uploaded: " + esc(file.name); toast("File uploaded"); }
      catch (er) { toast(er.message, "bad"); st.innerHTML = fileStatus(kind, hid.value); e.target.value = ""; }
      sub.disabled = false;
    });
    box.querySelector(".rm").addEventListener("click", () => { hid.value = ""; st.textContent = "No file attached (save to apply)"; });
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const err = m => ($("#ferr").textContent = m);
    err("");
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const fd = new FormData(form), p = { status: fd.get("status") };
    for (const [n, , ty, o = {}] of t.fields) {
      if (ty === "rich") continue;
      const v = String(fd.get(n) ?? "").trim();
      if (v) p[n] = v; else if (!o.nn) p[n] = null;
    }
    if (!p.slug) p.slug = slugify(p.title || "") || `${k}-${Date.now().toString(36)}`;
    if (p.opening_date && p.deadline && p.deadline < p.opening_date) return err("Deadline cannot be before the opening date.");
    if (quill) {
      if (!quill.getText().trim()) return err("Blog content is required.");
      p.content = DOMPurify.sanitize(quill.root.innerHTML);
    }
    const b = $(".acts .btn"); b.disabled = true;
    const { error } = id ? await sb.from(k).update(p).eq("id", id) : await sb.from(k).insert(p);
    b.disabled = false;
    if (error) return err(error.code === "23505" ? "This slug is already used. Change the slug." : error.message);
    toast("Saved"); location.hash = "#" + k;
  });
}

/* ---------- media library ---------- */
async function vMedia() {
  view.innerHTML = '<p class="muted">Loading…</p>';
  const { data: files, error } = await sb.from("media").select("*").order("created_at", { ascending: false }).limit(300);
  if (error) return (view.innerHTML = errBox(error));
  const used = new Set();
  for (const [k, col] of [["vacancies", "pdf_path"], ["vacancies", "featured_image_path"], ["notices", "pdf_path"], ["syllabuses", "pdf_path"], ["results", "pdf_path"], ["blogs", "featured_image_path"]]) {
    const { data } = await sb.from(k).select(col).not(col, "is", null);
    (data || []).forEach(r => used.add(r[col]));
  }
  if (!files.length) return (view.innerHTML = '<div class="box"><p class="empty">No uploaded files yet. Upload PDFs and images from the content forms.</p></div>');
  view.innerHTML = '<div class="box"><table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Usage</th><th></th></tr></thead><tbody>' + files.map(f => {
    const u = used.has(f.path);
    return `<tr><td class="t">${esc(f.original_name || f.path)}</td><td>${esc(f.bucket === "documents" ? "PDF" : "Image")}</td><td>${(f.size_bytes / 1024).toFixed(0)} KB</td><td>${esc(f.created_at.slice(0, 10))}</td>
      <td><span class="badge ${u ? "pub" : "exp"}">${u ? "In use" : "Unused"}</span></td>
      <td class="a"><a class="btn sm ghost" href="${esc(pubUrl(f.bucket, f.path))}" target="_blank" rel="noopener">Open</a>
      <button class="btn sm dangerg" data-id="${f.id}" data-b="${f.bucket}" data-p="${esc(f.path)}" ${u ? "disabled title=\"Used by content\"" : ""}>Delete</button></td></tr>`; }).join("") + "</tbody></table></div>";
  view.querySelector("tbody").addEventListener("click", async e => {
    const b = e.target.closest("button[data-id]"); if (!b || b.disabled) return;
    if (!confirm("Delete this file permanently?")) return;
    const r1 = await sb.storage.from(b.dataset.b).remove([b.dataset.p]);
    if (r1.error) return toast(r1.error.message, "bad");
    const r2 = await sb.from("media").delete().eq("id", b.dataset.id);
    r2.error ? toast(r2.error.message, "bad") : (toast("File deleted"), vMedia());
  });
}

/* ---------- start ---------- */
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  session ? enter(session) : showLogin();
})();
})();
