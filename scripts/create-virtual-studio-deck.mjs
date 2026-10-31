import fs from "node:fs";
import path from "node:path";
import pptxgen from "pptxgenjs";

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Virtual Studio";
pptx.subject = "Product overview";
pptx.title = "Virtual Studio — Remote collaboration";
pptx.company = "Virtual Studio";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Orbitron",
  bodyFontFace: "Inter",
  lang: "en-US",
};
pptx.defineSlideMaster({
  title: "VS_DARK",
  background: { color: "09090B" },
  objects: [
    { rect: { x: 0.48, y: 0.38, w: 0.055, h: 6.7, line: { color: "00FFFF", transparency: 100 }, fill: { color: "00FFFF", transparency: 20 } } },
    { line: { x: 0.78, y: 7.02, w: 11.8, h: 0, line: { color: "28282E", width: 0.8 } } },
  ],
  slideNumber: { x: 12.2, y: 7.08, color: "888894", fontFace: "Inter", fontSize: 9 },
});

const C = {
  bg: "09090B",
  panel: "131319",
  panel2: "191920",
  white: "F7F7FA",
  muted: "AAAAB6",
  cyan: "00FFFF",
  magenta: "FF00FF",
  purple: "9D00FF",
  border: "30303A",
};
const W = 13.333;
const H = 7.5;
const logoPath = path.resolve("attached_assets/generated_images/large_virtual_studio_globe_logo.png");
const logoData = fs.readFileSync(logoPath).toString("base64");
const logo = `data:image/png;base64,${logoData}`;

function text(slide, value, x, y, w, h, opts = {}) {
  slide.addText(value, {
    x, y, w, h, margin: 0, breakLine: false,
    fontFace: opts.display ? "Orbitron" : "Inter",
    fontSize: 16, color: C.white, valign: "mid",
    fit: "shrink", ...opts,
  });
}

function label(slide, value, x, y, w = 4) {
  text(slide, value.toUpperCase(), x, y, w, 0.26, {
    fontFace: "Rajdhani", fontSize: 11, bold: true,
    color: C.cyan, charSpacing: 2.3,
  });
}

function title(slide, heading, subtitle, eyebrow = "VIRTUAL STUDIO") {
  label(slide, eyebrow, 0.88, 0.62, 6);
  text(slide, heading, 0.88, 1.08, 11.6, 0.72, {
    display: true, bold: true, fontSize: 28, charSpacing: 0.5,
  });
  if (subtitle) {
    text(slide, subtitle, 0.9, 1.92, 11.1, 0.46, {
      fontSize: 15, color: C.muted,
    });
  }
}

function card(slide, x, y, w, h, heading, body, color = C.cyan, index) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.12,
    line: { color: C.border, width: 1 },
    fill: { color: C.panel },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.02, y: y + 0.2, w: 0.045, h: h - 0.4,
    line: { color, transparency: 100 }, fill: { color },
  });
  const top = index ? 0.3 : 0.42;
  if (index) {
    text(slide, index, x + 0.28, y + 0.24, 0.42, 0.3, {
      display: true, fontSize: 14, bold: true, color,
    });
  }
  text(slide, heading, x + 0.28, y + top, w - 0.55, 0.48, {
    display: true, fontSize: 16, bold: true,
  });
  text(slide, body, x + 0.28, y + top + 0.58, w - 0.56, h - top - 0.76, {
    fontSize: 13, color: C.muted, valign: "top", breakLine: false,
    lineSpacingMultiple: 1.08,
  });
}

function newSlide(heading, subtitle, eyebrow) {
  const slide = pptx.addSlide("VS_DARK");
  title(slide, heading, subtitle, eyebrow);
  return slide;
}

// 1 — Cover
{
  const slide = pptx.addSlide();
  slide.background = { color: C.bg };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: 0.08,
    line: { color: C.cyan, transparency: 100 },
    fill: { color: C.cyan },
  });
  slide.addImage({ data: logo, x: 0.76, y: 0.65, w: 2.35, h: 2.35 });
  label(slide, "REMOTE COLLABORATION", 0.9, 3.18, 5.3);
  text(slide, "VIRTUAL\nSTUDIO", 0.85, 3.55, 8.3, 1.68, {
    display: true, fontSize: 38, bold: true, breakLine: false,
    charSpacing: 2, valign: "mid",
  });
  text(slide, "A shared space for guided, real-time sessions.", 0.92, 5.52, 8.7, 0.55, {
    fontSize: 19, color: C.muted,
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.92, y: 6.48, w: 3.2, h: 0,
    line: { color: C.magenta, width: 3 },
  });
  text(slide, "PRODUCT OVERVIEW", 0.92, 6.67, 4, 0.28, {
    fontFace: "Rajdhani", fontSize: 11, color: C.cyan, charSpacing: 2,
  });
}

// 2 — Product promise
{
  const slide = newSlide(
    "Bring the session closer",
    "Virtual Studio connects collaborators when they can't share the same room.",
    "THE IDEA",
  );
  card(slide, 0.9, 2.75, 3.65, 2.25, "Share context", "See the work together during a live remote session.", C.cyan, "01");
  card(slide, 4.85, 2.75, 3.65, 2.25, "Guide in real time", "Talk through decisions while collaborators follow along.", C.magenta, "02");
  card(slide, 8.8, 2.75, 3.65, 2.25, "Keep the work moving", "Create a room or join one with a short session code.", C.purple, "03");
  text(slide, "A focused workflow for remote studio collaboration.", 0.92, 5.65, 10.7, 0.44, {
    fontSize: 18, color: C.white,
  });
}

// 3 — Participants
{
  const slide = newSlide(
    "One room, different roles",
    "Choose a role as you enter so everyone has a clear place in the session.",
    "WHO IT'S FOR",
  );
  const roles = [
    ["Artist", "Shares the work and sets the session context.", C.magenta],
    ["Engineer", "Guides the technical work and collaboration.", C.cyan],
    ["Producer", "Joins the conversation and helps shape decisions.", C.purple],
    ["Other", "Makes room for additional collaborators.", "F0A6FF"],
  ];
  roles.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    card(slide, 0.9 + col * 5.9, 2.68 + row * 1.65, 5.45, 1.38, r[0], r[1], r[2]);
  });
}

// 4 — Session flow
{
  const slide = newSlide(
    "Start with a room code",
    "The home screen keeps the main session actions straightforward.",
    "HOW IT WORKS",
  );
  const steps = [
    ["Create", "Choose a role and start a session."],
    ["Invite", "Share the short room code with collaborators."],
    ["Join", "Enter the code and choose a role."],
    ["Collaborate", "Meet in the shared session."],
  ];
  steps.forEach((s, i) => {
    const x = 0.9 + i * 3.0;
    card(slide, x, 3.04, 2.55, 2.0, s[0], s[1], [C.cyan, C.magenta, C.purple, C.cyan][i], `0${i + 1}`);
    if (i < steps.length - 1) {
      slide.addShape(pptx.ShapeType.line, {
        x: x + 2.58, y: 4.03, w: 0.38, h: 0,
        line: { color: C.border, width: 2, beginArrowType: "none", endArrowType: "triangle" },
      });
    }
  });
  text(slide, "Session creation is subscription-gated; joining uses a room code.", 0.92, 5.65, 11, 0.35, {
    fontSize: 13, color: C.muted,
  });
}

// 5 — Remote collaboration
{
  const slide = newSlide(
    "See the work. Guide the next move.",
    "Remote-control tools are designed to keep input connected to the active session.",
    "IN THE SESSION",
  );
  card(slide, 0.9, 2.77, 5.5, 2.45, "Shared screen", "Follow the host computer's screen during the collaboration.", C.cyan);
  card(slide, 6.75, 2.77, 5.5, 2.45, "Remote input", "Use supported mouse and keyboard controls when access is enabled.", C.magenta);
  text(slide, "Control belongs to an active authorization—not just an open page.", 0.93, 5.75, 11.4, 0.44, {
    fontSize: 17, color: C.white,
  });
}

// 6 — Agent
{
  const slide = newSlide(
    "Meet the Virtual Studio Agent",
    "A desktop companion connects the host computer to remote-control sessions.",
    "DESKTOP COMPANION",
  );
  slide.addImage({ data: logo, x: 0.92, y: 2.72, w: 2.25, h: 2.25 });
  text(slide, "A bridge between the shared room\nand the host's workstation.", 3.55, 2.92, 7.9, 0.95, {
    display: true, fontSize: 21, bold: true, breakLine: false,
  });
  text(slide, "Installer workflows target Windows, macOS, and Linux.", 3.58, 4.12, 7.5, 0.55, {
    fontSize: 16, color: C.muted,
  });
  ["WINDOWS", "macOS", "LINUX"].forEach((name, i) => {
    const x = 3.58 + i * 2.28;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y: 5.05, w: 1.9, h: 0.5,
      rectRadius: 0.08, line: { color: C.border, width: 1 },
      fill: { color: C.panel2 },
    });
    text(slide, name, x + 0.12, 5.13, 1.66, 0.3, {
      fontFace: "Rajdhani", fontSize: 12, bold: true, align: "center", color: C.cyan,
    });
  });
}

// 7 — Membership
{
  const slide = newSlide(
    "A clear path to Pro",
    "Virtual Studio Pro supports ongoing sessions and shared session resources.",
    "ACCESS & MEMBERSHIP",
  );
  card(slide, 0.9, 2.82, 5.45, 2.45, "Unlimited sessions", "Pro membership unlocks unlimited recording sessions.", C.cyan);
  card(slide, 6.75, 2.82, 5.45, 2.45, "Cloud recording library", "Recordings are available through the library experience.", C.magenta);
  text(slide, "Subscription checkout is handled through Stripe.", 0.94, 5.82, 10.4, 0.36, {
    fontSize: 14, color: C.muted,
  });
}

// 8 — Closing
{
  const slide = newSlide(
    "More context. Better-guided sessions.",
    "Virtual Studio brings the room, the screen, and collaborators into one workflow.",
    "THE TAKEAWAY",
  );
  card(slide, 0.9, 2.9, 3.65, 2.1, "Connect", "Create a room or join by code.", C.cyan);
  card(slide, 4.85, 2.9, 3.65, 2.1, "Collaborate", "Share the screen and guide work together.", C.magenta);
  card(slide, 8.8, 2.9, 3.65, 2.1, "Improve", "Keep refining control safety and release checks.", C.purple);
  slide.addImage({ data: logo, x: 0.92, y: 5.55, w: 0.62, h: 0.62 });
  text(slide, "VIRTUAL STUDIO", 1.7, 5.68, 4.5, 0.35, {
    display: true, fontSize: 13, bold: true, color: C.cyan, charSpacing: 1.3,
  });
}

const outputDir = path.resolve("generated-artifacts");
fs.mkdirSync(outputDir, { recursive: true });
await pptx.writeFile({ fileName: path.join(outputDir, "virtual-studio-overview.pptx") });
console.log(`Created ${path.join(outputDir, "virtual-studio-overview.pptx")} with ${pptx._slides.length} slides.`);
