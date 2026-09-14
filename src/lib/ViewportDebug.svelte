<script lang="ts">
  // TEMPORARY diagnostic (2026-09-14): shown only with `?debug-viewport` in the URL. Finds WHERE the
  // iPad "app shifted up, blank space under the status bar" lives after a text field takes the
  // keyboard: window scroll, a panned visual viewport, or a scrolled element inside the fixed #app.
  // Pinned to the BOTTOM, so it stays on screen when the layout is pushed up. Remove once diagnosed.
  import { onMount } from "svelte";

  let text = $state("viewport debug: waiting for events");
  const peak: Record<string, number> = {};
  const events: string[] = [];

  function describe(el: Element): string {
    const id = el.id ? `#${el.id}` : el.tagName.toLowerCase();
    const cls = [...el.classList].slice(0, 2).join(".");
    return cls ? `${id}.${cls}` : id;
  }

  function sample(ev: string) {
    const app = document.getElementById("app");
    const column = app?.firstElementChild as HTMLElement | null;
    const vv = window.visualViewport;
    const scrolled = [...document.querySelectorAll("*")]
      .filter((el) => el.scrollTop > 0 && !el.classList.contains("timeline-grid"))
      .slice(0, 3)
      .map((el) => `${describe(el)}=${Math.round(el.scrollTop)}`);
    const now: Record<string, number> = {
      winY: Math.round(window.scrollY),
      docTop: Math.round(document.scrollingElement?.scrollTop ?? 0),
      bodyTop: Math.round(document.body.scrollTop),
      appTop: Math.round(app?.scrollTop ?? 0),
      appRectTop: Math.round(app?.getBoundingClientRect().top ?? 0),
      appRectH: Math.round(app?.getBoundingClientRect().height ?? 0),
      colTop: Math.round(column?.scrollTop ?? 0),
      colRectTop: Math.round(column?.getBoundingClientRect().top ?? 0),
      vvOffTop: Math.round(vv?.offsetTop ?? 0),
      vvPageTop: Math.round(vv?.pageTop ?? 0),
      vvH: Math.round(vv?.height ?? 0),
      vvScale: Math.round((vv?.scale ?? 1) * 100),
      innerH: window.innerHeight,
      clientH: document.documentElement.clientHeight,
    };
    for (const [k, v] of Object.entries(now)) {
      if (Math.abs(v) > Math.abs(peak[k] ?? 0)) peak[k] = v;
    }
    const active = document.activeElement;
    events.unshift(
      `${ev} win${now.winY} app${now.appTop} col${now.colTop} vv${now.vvOffTop}/${now.vvH} ${active ? describe(active) : ""}`,
    );
    events.length = Math.min(events.length, 6);
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
    text = [
      `NOW  ${fmt(now)}`,
      `PEAK ${fmt(peak)}`,
      `scrolled: ${scrolled.join(" ") || "none"}`,
      ...events,
    ].join("\n");
  }

  onMount(() => {
    const on = (target: EventTarget | null | undefined, type: string, capture = false) => {
      const h = () => sample(type);
      target?.addEventListener(type, h, capture);
      return () => target?.removeEventListener(type, h, capture);
    };
    const offs = [
      on(window, "scroll", true),
      on(window, "resize"),
      on(window.visualViewport, "resize"),
      on(window.visualViewport, "scroll"),
      on(document, "focusin"),
      on(document, "focusout"),
    ];
    const timer = setInterval(() => sample("tick"), 1000);
    sample("mount");
    return () => {
      offs.forEach((off) => off());
      clearInterval(timer);
    };
  });
</script>

<div
  class="pointer-events-none fixed inset-x-1 bottom-1 z-1000 rounded bg-black/85 p-1 font-mono text-[10px]/3 whitespace-pre-wrap text-lime-300"
>
  {text}
</div>
