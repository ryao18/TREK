import { actions, always, eventually, extract, next, now, weighted } from "@antithesishq/bombadil";
export * from "@antithesishq/bombadil/defaults";

type Point = { x: number; y: number };

function isVisible(el: Element | null): el is Element {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function centerOf(el: Element | null): Point | null {
  if (!isVisible(el)) return null;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function textOf(el: Element | null): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

const route = extract((state) => state.window.location.pathname);

const loginFormVisible = extract((state) => {
  const form = state.document.querySelector("form");
  return !!form && isVisible(form);
});

const spinnerCount = extract((state) =>
  state.document.querySelectorAll(".animate-spin, [aria-busy='true']").length,
);

const toastCount = extract((state) =>
  state.document.querySelectorAll(".nomad-toast").length,
);

const visibleTripTitles = extract((state) => {
  if (state.window.location.pathname !== "/dashboard") return [];

  return Array.from(state.document.querySelectorAll("h2, h3"))
    .filter((heading) => {
      if (!isVisible(heading)) return false;
      if (heading.closest("nav")) return false;
      if (heading.closest(".modal-backdrop")) return false;
      const text = textOf(heading);
      return text.length > 0 && text !== "TREK";
    })
    .map((heading) => textOf(heading));
});

const tripModalState = extract((state) => {
  const modal = state.document.querySelector(".modal-backdrop");
  if (!modal || !isVisible(modal)) return null;

  const titleInput = modal.querySelector("input[type='text']");
  const descriptionInput = modal.querySelector("textarea");
  const dateButtons = Array.from(modal.querySelectorAll("button")).filter((button) => {
    if (!isVisible(button)) return false;
    if (button.closest("nav")) return false;
    const text = textOf(button);
    const rect = button.getBoundingClientRect();
    if (rect.width < 100) return false;
    if (text === "" || /cancel|create|update|change|upload/i.test(text)) return false;
    return !button.querySelector(".animate-spin");
  });
  const footerButtons = Array.from(modal.querySelectorAll("button")).filter((button) => isVisible(button));
  const submitButton = footerButtons.length > 0 ? footerButtons[footerButtons.length - 1] : null;
  const errorBox = Array.from(modal.querySelectorAll("div")).find((div) =>
    typeof div.className === "string" && /red-(50|200|600)/.test(div.className),
  );

  return {
    title: titleInput instanceof HTMLInputElement ? titleInput.value : "",
    titlePoint: centerOf(titleInput),
    descriptionPoint: centerOf(descriptionInput),
    startDatePoint: centerOf(dateButtons[0] || null),
    endDatePoint: centerOf(dateButtons[1] || null),
    submitPoint: centerOf(submitButton),
    submitDisabled: submitButton instanceof HTMLButtonElement ? submitButton.disabled : false,
    saving: !!submitButton?.querySelector(".animate-spin"),
    hasError: !!errorBox && isVisible(errorBox),
  };
});

const datePickerOpen = extract((state) => {
  const clearButton = Array.from(state.document.querySelectorAll("button")).find((button) => {
    if (!isVisible(button)) return false;
    return textOf(button) === "✕";
  });
  return !!clearButton;
});

const dateCellPoints = extract((state) => {
  return Array.from(state.document.querySelectorAll("button"))
    .filter((button) => {
      if (!isVisible(button)) return false;
      const text = textOf(button);
      return /^\d{1,2}$/.test(text) && button.getBoundingClientRect().width <= 40;
    })
    .slice(0, 10)
    .map((button) => ({
      name: `day ${textOf(button)}`,
      point: centerOf(button),
    }))
    .filter((entry): entry is { name: string; point: Point } => !!entry.point);
});

const activeField = extract((state) => {
  const active = state.document.activeElement;
  if (!active) return "none";
  if (active instanceof HTMLInputElement && active.type === "text") return "title";
  if (active instanceof HTMLTextAreaElement) return "description";
  return "other";
});

const createTripButtonPoint = extract((state) => {
  if (state.window.location.pathname !== "/dashboard") return null;

  const buttons = Array.from(state.document.querySelectorAll("button")).filter((button) => {
    if (!isVisible(button)) return false;
    if (button.closest("nav")) return false;
    if (button.closest(".modal-backdrop")) return false;
    if (button.disabled) return false;
    const text = textOf(button);
    if (!text) return false;
    const rect = button.getBoundingClientRect();
    return rect.top < 300 && rect.width >= 110;
  });

  return centerOf(buttons[0] || null);
});

const dashboardLinkPoint = extract((state) => {
  const link = state.document.querySelector('a[href="/dashboard"]');
  return centerOf(link);
});

const tripCardHeadingPoints = extract((state) => {
  if (state.window.location.pathname !== "/dashboard") return [];

  return Array.from(state.document.querySelectorAll("h2, h3"))
    .filter((heading) => {
      if (!isVisible(heading)) return false;
      if (heading.closest("nav")) return false;
      if (heading.closest(".modal-backdrop")) return false;
      return textOf(heading).length > 0 && textOf(heading) !== "TREK";
    })
    .slice(0, 8)
    .map((heading) => ({
      name: textOf(heading),
      point: centerOf(heading),
    }))
    .filter((entry): entry is { name: string; point: Point } => !!entry.point);
});

const plannerState = extract((state) => {
  const path = state.window.location.pathname;
  if (!/^\/trips\/\d+/.test(path)) return null;

  const dayBadges = Array.from(state.document.querySelectorAll("div"))
    .filter((div) => {
      if (!isVisible(div)) return false;
      const text = textOf(div);
      const rect = div.getBoundingClientRect();
      return /^\d+$/.test(text) && rect.width >= 20 && rect.width <= 40 && rect.height >= 20 && rect.height <= 40;
    })
    .map((div) => Number(textOf(div)));

  const plannerTabs = Array.from(state.document.querySelectorAll("button"))
    .filter((button) => {
      if (!isVisible(button)) return false;
      const rect = button.getBoundingClientRect();
      return rect.top < 120 && rect.width > 40;
    }).length;

  const tripTitle = textOf(state.document.querySelector("title")) || textOf(state.document.querySelector("nav + div div"));

  return {
    dayBadges,
    plannerTabs,
    tripTitle,
  };
});

export const bypassDoesNotLeaveYouOnLogin = always(
  now(() => route.current === "/login" && loginFormVisible.current).implies(
    eventually(() => route.current !== "/login").within(5, "seconds"),
  ),
);

export const modalsEventuallySettleAfterSave = always(
  now(() => !!tripModalState.current?.saving).implies(
    eventually(() => tripModalState.current === null).within(15, "seconds"),
  ),
);

export const createdTripEventuallyAppearsOnDashboard = always(() => {
  const title = (tripModalState.current?.title || "").trim();
  return now(() => title !== "")
    .and(next(() => !!tripModalState.current?.saving))
    .implies(
      eventually(() => visibleTripTitles.current.includes(title)).within(20, "seconds"),
    );
});

export const errorsDoNotPileUp = always(() => toastCount.current <= 5);

export const loadingDoesNotHangForever = always(
  now(() => spinnerCount.current > 0).implies(
    eventually(() => spinnerCount.current === 0).within(20, "seconds"),
  ),
);

export const plannerLoadsWithNavigation = always(() => {
  if (!plannerState.current) return true;
  return plannerState.current.plannerTabs > 0;
});

export const plannerHasSequentialDayBadges = always(() => {
  if (!plannerState.current) return true;
  const badges = plannerState.current.dayBadges.slice().sort((a, b) => a - b);
  if (badges.length === 0) return true;
  return badges.every((value, index) => value === index + 1);
});

const tripTitles = [
  "Bombadil Tokyo Sprint",
  "Bombadil Alpine Weekend",
  "Bombadil Desert Loop",
  "Bombadil Island Escape",
  "Bombadil City Break",
];

const tripDescriptions = [
  "Created by Bombadil to exercise TREK trip creation flows.",
  "Short randomized journey for local exploratory testing.",
  "Property-based trip data for dashboard and planner validation.",
];

export const openCreateTripModal = actions(() => {
  const point = createTripButtonPoint.current;
  return point ? [{ Click: { name: "open create trip modal", point } }] : [];
});

export const focusTripTitle = actions(() => {
  const point = tripModalState.current?.titlePoint;
  return point ? [{ Click: { name: "focus trip title", point } }] : [];
});

export const typeTripTitle = actions(() => {
  if (activeField.current !== "title") return [];
  if ((tripModalState.current?.title || "").length > 0) return [];
  return tripTitles.map((title) => ({
    TypeText: { text: title, delayMillis: 10 },
  }));
});

export const focusTripDescription = actions(() => {
  if (!tripModalState.current?.title) return [];
  const point = tripModalState.current?.descriptionPoint;
  return point ? [{ Click: { name: "focus trip description", point } }] : [];
});

export const openStartDatePicker = actions(() => {
  if (datePickerOpen.current) return [];
  const point = tripModalState.current?.startDatePoint;
  return point ? [{ Click: { name: "open start date picker", point } }] : [];
});

export const pickStartDate = actions(() => {
  if (!datePickerOpen.current) return [];
  return dateCellPoints.current.map((entry) => ({
    Click: { name: `pick ${entry.name} for start`, point: entry.point },
  }));
});

export const openEndDatePicker = actions(() => {
  if (datePickerOpen.current) return [];
  if (!tripModalState.current?.title) return [];
  const point = tripModalState.current?.endDatePoint;
  return point ? [{ Click: { name: "open end date picker", point } }] : [];
});

export const pickEndDate = actions(() => {
  if (!datePickerOpen.current) return [];
  return dateCellPoints.current.map((entry) => ({
    Click: { name: `pick ${entry.name} for end`, point: entry.point },
  }));
});

export const typeTripDescription = actions(() => {
  if (activeField.current !== "description") return [];
  return tripDescriptions.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

export const submitTripModal = actions(() => {
  const modal = tripModalState.current;
  if (!modal?.submitPoint) return [];
  if (!modal.title || modal.submitDisabled || modal.saving) return [];
  return [{ Click: { name: "submit trip modal", point: modal.submitPoint } }];
});

export const openTripFromDashboard = actions(() => {
  if (route.current !== "/dashboard") return [];
  return tripCardHeadingPoints.current.map((entry) => ({
    Click: { name: `open trip ${entry.name}`, point: entry.point },
  }));
});

export const returnToDashboard = actions(() => {
  const point = dashboardLinkPoint.current;
  return point ? [{ Click: { name: "return to dashboard", point } }] : [];
});

export const tripFocusedExploration = weighted([
  [10, openCreateTripModal],
  [12, focusTripTitle],
  [20, typeTripTitle],
  [6, openStartDatePicker],
  [6, pickStartDate],
  [6, openEndDatePicker],
  [6, pickEndDate],
  [6, focusTripDescription],
  [8, typeTripDescription],
  [14, submitTripModal],
  [8, openTripFromDashboard],
  [4, returnToDashboard],
]);
