import { actions, always, eventually, extract, next, now, weighted } from "@antithesishq/bombadil";

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

function queryHook(state: { document: Document }, hook: string): Element | null {
  return state.document.querySelector(`[data-bombadil="${hook}"]`);
}

function pickPointByText(
  nodes: Element[],
  patterns: string[],
  options: { title?: boolean; topMax?: number } = {},
): Point | null {
  const matched = nodes.find((node) => {
    if (!isVisible(node)) return false;
    const rect = node.getBoundingClientRect();
    if (options.topMax != null && rect.top > options.topMax) return false;
    const haystack = `${textOf(node)} ${options.title ? (node.getAttribute("title") || "") : ""}`.toLowerCase();
    return patterns.some((pattern) => haystack.includes(pattern.toLowerCase()));
  });
  return centerOf(matched || null);
}

function visibleBodyText(state: { document: Document }): string {
  return (state.document.body?.innerText || "").replace(/\s+/g, " ").trim();
}

function findClickableAncestor(el: Element | null): Element | null {
  let current = el;
  while (current && current !== document.body) {
    if (current instanceof HTMLElement && current.style.cursor === "pointer") return current;
    current = current.parentElement;
  }
  return null;
}

function findDashboardTripCards(state: { document: Document }): HTMLElement[] {
  return Array.from(state.document.querySelectorAll("div"))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => {
      if (!isVisible(node)) return false;
      if (node.closest("nav")) return false;
      if (node.closest(".modal-backdrop")) return false;
      if (node.style.cursor !== "pointer") return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 120;
    });
}

function findDashboardTripTitle(card: HTMLElement): string | null {
  const candidates = Array.from(card.querySelectorAll("h2, h3, span"))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter((node) => {
      if (!isVisible(node)) return false;
      const text = textOf(node);
      if (!text || text === "TREK") return false;
      if (/^(days|places|members|shared|today|tomorrow|ongoing|past|future)$/i.test(text)) return false;
      if (/^\d+$/.test(text)) return false;
      const weight = Number(node.style.fontWeight || "0");
      return weight >= 600 || node.tagName === "H2" || node.tagName === "H3";
    })
    .map((node) => textOf(node));

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function findVisiblePlaceRowByName(state: { document: Document }, name: string): Element | null {
  if (!name.trim()) return null;
  const labels = Array.from(state.document.querySelectorAll("span, div"));
  for (const label of labels) {
    if (!isVisible(label)) continue;
    if (textOf(label) !== name) continue;
    let current: Element | null = label;
    while (current) {
      const buttons = Array.from(current.querySelectorAll("button"));
      if (buttons.length > 0) return current;
      current = current.parentElement;
    }
  }
  return null;
}

function findPlacesSidebarRowByName(state: { document: Document }, name: string): Element | null {
  if (!name.trim()) return null;
  const labels = Array.from(state.document.querySelectorAll("span"));
  for (const label of labels) {
    if (!isVisible(label)) continue;
    if (textOf(label) !== name) continue;
    let current: Element | null = label;
    while (current) {
      if (current instanceof HTMLElement && current.style.cursor === "grab") {
        const plusButton = Array.from(current.querySelectorAll("button")).find((button) => {
          if (!isVisible(button)) return false;
          if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
          const rect = button.getBoundingClientRect();
          return rect.width <= 24 && rect.height <= 24 && button.querySelector("svg") !== null;
        });
        if (plusButton) return current;
      }
      current = current.parentElement;
    }
  }
  return null;
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

const visibleText = extract((state) => visibleBodyText(state));

const visibleTripTitles = extract((state) => {
  if (state.window.location.pathname !== "/dashboard") return [];

  return findDashboardTripCards(state)
    .map((card) => findDashboardTripTitle(card))
    .filter((title): title is string => !!title);
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

const dateCellPoints = extract((state) =>
  Array.from(state.document.querySelectorAll("button"))
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
    .filter((entry): entry is { name: string; point: Point } => !!entry.point),
);

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
    if (!/^new trip$/i.test(text) && !/^create new trip$/i.test(text)) return false;
    const rect = button.getBoundingClientRect();
    return rect.top < 300 && rect.width >= 90;
  });

  return centerOf(buttons[0] || null);
});

const dashboardLinkPoint = extract((state) => {
  const link = state.document.querySelector('a[href="/dashboard"]');
  return centerOf(link);
});

const tripCardHeadingPoints = extract((state) => {
  if (state.window.location.pathname !== "/dashboard") return [];

  return findDashboardTripCards(state)
    .slice(0, 1)
    .map((card) => ({
      name: findDashboardTripTitle(card) || "dashboard trip",
      point: centerOf(card),
    }))
    .filter((entry): entry is { name: string; point: Point } => !!entry.point);
});

const plannerState = extract((state) => {
  const path = state.window.location.pathname;
  if (!/^\/trips\/\d+/.test(path)) return null;

  const buttons = Array.from(state.document.querySelectorAll("button"));
  const bodyText = visibleBodyText(state);
  const dayBadges = Array.from(state.document.querySelectorAll("div"))
    .filter((div) => {
      if (!isVisible(div)) return false;
      const text = textOf(div);
      const rect = div.getBoundingClientRect();
      return /^\d+$/.test(text) && rect.width >= 20 && rect.width <= 40 && rect.height >= 20 && rect.height <= 40;
    })
    .map((div) => Number(textOf(div)));

  const plannerTabs = buttons.filter((button) => {
    if (!isVisible(button)) return false;
    const rect = button.getBoundingClientRect();
    return rect.top < 120 && rect.width > 40;
  }).length;

  const tabButtons = buttons.filter((button) => {
    if (!isVisible(button)) return false;
    const rect = button.getBoundingClientRect();
    return rect.top < 120 && rect.width > 40;
  });

  return {
    dayBadges,
    plannerTabs,
    tripTitle: textOf(state.document.querySelector("title")) || textOf(state.document.querySelector("nav + div div")),
    bookingsTabPoint: pickPointByText(tabButtons, ["Bookings", "Book", "Buchungen"], { title: true }),
    packingTabPoint: pickPointByText(tabButtons, ["Packing", "Packing List", "Packliste"], { title: true }),
    budgetTabPoint: pickPointByText(tabButtons, ["Budget", "Finanzplan"], { title: true }),
    collabTabPoint: pickPointByText(tabButtons, ["Collab", "Zusammenarbeit"], { title: true }),
    planTabPoint: pickPointByText(tabButtons, ["Plan"], { title: true }),
    shellReady:
      plannerTabs > 0 ||
      dayBadges.length > 0 ||
      bodyText.includes("Add Place/Activity") ||
      bodyText.includes("Morning") ||
      bodyText.includes("Bookings"),
  };
});

const reservationsState = extract((state) => {
  if (!/^\/trips\/\d+/.test(state.window.location.pathname)) return null;
  const buttons = Array.from(state.document.querySelectorAll("button"));
  const titleInput = queryHook(state, "reservation-title") || state.document.querySelector("input[placeholder*='Lufthansa'], input[placeholder*='Hotel Adlon']");
  const locationInput = queryHook(state, "reservation-location") || state.document.querySelector("input[placeholder*='address'], input[placeholder*='Address']");
  const notesInput = queryHook(state, "reservation-notes") || state.document.querySelector("textarea[placeholder*='notes'], textarea[placeholder*='Notes']");
  const submitButton = queryHook(state, "reservation-submit");
  return {
    addPoint: pickPointByText(buttons, ["Manual Booking", "Rezerwacja ręczna", "Reserva manual"], { title: true }),
    visibleTitles: Array.from(state.document.querySelectorAll("span, h2, h3, h4"))
      .map((node) => textOf(node))
      .filter((text) => text.length > 3),
    modalOpen: !!titleInput,
    titleValue: titleInput instanceof HTMLInputElement ? titleInput.value : "",
    locationValue: locationInput instanceof HTMLInputElement ? locationInput.value : "",
    titlePoint: centerOf(titleInput),
    locationPoint: centerOf(locationInput),
    notesPoint: centerOf(notesInput),
    submitPoint: centerOf(submitButton),
    submitDisabled: submitButton instanceof HTMLButtonElement ? submitButton.disabled : false,
    activeField: (() => {
      const active = state.document.activeElement;
      if (active instanceof HTMLElement) {
        const hook = active.getAttribute("data-bombadil");
        if (hook === "reservation-title") return "reservation-title";
        if (hook === "reservation-location") return "reservation-location";
        if (hook === "reservation-notes") return "reservation-notes";
      }
      if (active instanceof HTMLInputElement) {
        const placeholder = (active.placeholder || "").toLowerCase();
        if (placeholder.includes("lufthansa") || placeholder.includes("hotel adlon")) return "reservation-title";
        if (placeholder.includes("address")) return "reservation-location";
      }
      if (active instanceof HTMLTextAreaElement) return "reservation-notes";
      return "other";
    })(),
  };
});

const packingState = extract((state) => {
  if (!/^\/trips\/\d+/.test(state.window.location.pathname)) return null;
  const buttons = Array.from(state.document.querySelectorAll("button"));
  const itemInput = queryHook(state, "packing-item-input") || state.document.querySelector("input[placeholder='Item name...']");
  const addButton = queryHook(state, "packing-item-submit");
  const openAddButton = queryHook(state, "packing-open-add");

  return {
    addPoint: centerOf(openAddButton) || pickPointByText(buttons, ["Add item"], { title: true }),
    itemPoint: centerOf(itemInput),
    itemValue: itemInput instanceof HTMLInputElement ? itemInput.value : "",
    submitPoint: centerOf(addButton || null),
    visibleText: visibleBodyText(state),
    activeField: (() => {
      const active = state.document.activeElement;
      if (active instanceof HTMLElement && active.getAttribute("data-bombadil") === "packing-item-input") return "packing-item";
      if (active instanceof HTMLInputElement && active.placeholder === "Item name...") return "packing-item";
      return "other";
    })(),
  };
});

const budgetState = extract((state) => {
  if (!/^\/trips\/\d+/.test(state.window.location.pathname)) return null;
  const nameInput = state.document.querySelector("input[placeholder='New Entry']");
  const row = nameInput?.closest("tr") || null;
  const priceInput = row?.querySelector("input[placeholder='0,00']") || null;
  const noteInput = row?.querySelector("input[placeholder='Note']") || null;
  const submit = row?.querySelector("button[title='Add']") || null;

  return {
    namePoint: centerOf(nameInput),
    pricePoint: centerOf(priceInput),
    notePoint: centerOf(noteInput),
    submitPoint: centerOf(submit),
    nameValue: nameInput instanceof HTMLInputElement ? nameInput.value : "",
    visibleText: visibleBodyText(state),
    activeField: (() => {
      const active = state.document.activeElement;
      if (active instanceof HTMLInputElement) {
        if (active.placeholder === "New Entry") return "budget-name";
        if (active.placeholder === "0,00") return "budget-price";
        if (active.placeholder === "Note") return "budget-note";
      }
      return "other";
    })(),
  };
});

const collabState = extract((state) => {
  if (!/^\/trips\/\d+/.test(state.window.location.pathname)) return null;
  const buttons = Array.from(state.document.querySelectorAll("button"));
  const chatBox = queryHook(state, "collab-chat-input") || state.document.querySelector("textarea[placeholder='Type a message...']");
  const noteTitle = queryHook(state, "collab-note-title") || state.document.querySelector("input[placeholder='Note title']");
  const noteContent = queryHook(state, "collab-note-content") || state.document.querySelector("textarea[placeholder='Write something...']");
  const noteForm = noteTitle?.closest("form") || noteContent?.closest("form") || null;
  const pollQuestion = queryHook(state, "collab-poll-question") || state.document.querySelector("input[placeholder='What should we do?']");
  const pollForm = pollQuestion?.closest("form") || null;
  const optionInputs = [
    queryHook(state, "collab-poll-option-1"),
    queryHook(state, "collab-poll-option-2"),
  ].filter((input): input is HTMLInputElement => input instanceof HTMLInputElement);
  const sendButton = queryHook(state, "collab-chat-send");
  const newNoteButton = queryHook(state, "collab-new-note");
  const noteSubmitButton = queryHook(state, "collab-note-submit");
  const newPollButton = queryHook(state, "collab-new-poll");
  const pollSubmitButton = queryHook(state, "collab-poll-submit");

  return {
    chatPoint: centerOf(chatBox),
    chatValue: chatBox instanceof HTMLTextAreaElement ? chatBox.value : "",
    chatSendPoint: centerOf(sendButton || null),
    newNotePoint: centerOf(newNoteButton) || pickPointByText(buttons, ["New Note"], { title: true }),
    noteModalOpen: !!noteTitle,
    noteTitlePoint: centerOf(noteTitle),
    noteTitleValue: noteTitle instanceof HTMLInputElement ? noteTitle.value : "",
    noteContentPoint: centerOf(noteContent),
    noteSubmitPoint: centerOf(noteSubmitButton || noteForm?.querySelector("button[type='submit']") || null),
    noteSubmitDisabled: noteSubmitButton instanceof HTMLButtonElement ? noteSubmitButton.disabled : false,
    newPollPoint: centerOf(newPollButton) || pickPointByText(buttons, ["New Poll"], { title: true }),
    pollModalOpen: !!pollQuestion,
    pollQuestionPoint: centerOf(pollQuestion),
    pollQuestionValue: pollQuestion instanceof HTMLInputElement ? pollQuestion.value : "",
    pollOptionOnePoint: centerOf(optionInputs[0] || null),
    pollOptionTwoPoint: centerOf(optionInputs[1] || null),
    pollOptionValues: optionInputs.map((input) => input.value),
    pollSubmitPoint: centerOf(pollSubmitButton || pollForm?.querySelector("button[type='submit']") || null),
    pollSubmitDisabled: pollSubmitButton instanceof HTMLButtonElement ? pollSubmitButton.disabled : false,
    votePoints: buttons
      .filter((button) => {
        if (!isVisible(button)) return false;
        if (button.closest("form")) return false;
        const text = textOf(button);
        return text.length > 0 && text.length < 80 && !/New Poll|New Note|Create Poll|Create/.test(text);
      })
      .slice(0, 5)
      .map((button) => ({
        name: textOf(button),
        point: centerOf(button),
      }))
      .filter((entry): entry is { name: string; point: Point } => !!entry.point),
    visibleText: visibleBodyText(state),
    activeField: (() => {
      const active = state.document.activeElement;
      if (active instanceof HTMLElement) {
        const hook = active.getAttribute("data-bombadil");
        if (hook === "collab-chat-input") return "chat";
        if (hook === "collab-note-title") return "note-title";
        if (hook === "collab-note-content") return "note-content";
        if (hook === "collab-poll-question") return "poll-question";
        if (hook === "collab-poll-option-1") return "poll-option-1";
        if (hook === "collab-poll-option-2") return "poll-option-2";
      }
      if (active instanceof HTMLTextAreaElement && active.placeholder === "Type a message...") return "chat";
      if (active instanceof HTMLInputElement && active.placeholder === "Note title") return "note-title";
      if (active instanceof HTMLTextAreaElement && active.placeholder === "Write something...") return "note-content";
      if (active instanceof HTMLInputElement && active.placeholder === "What should we do?") return "poll-question";
      if (active instanceof HTMLInputElement && active.placeholder === "Option 1") return "poll-option-1";
      if (active instanceof HTMLInputElement && active.placeholder === "Option 2") return "poll-option-2";
      return "other";
    })(),
  };
});

const planningState = extract((state) => {
  if (!/^\/trips\/\d+/.test(state.window.location.pathname)) return null;
  const buttons = Array.from(state.document.querySelectorAll("button"));
  const nameInput = queryHook(state, "planner-place-name") || state.document.querySelector("input[placeholder='e.g. Eiffel Tower']");
  const descriptionInput = queryHook(state, "planner-place-description") || state.document.querySelector("textarea[placeholder='Short description...']");
  const addressInput = queryHook(state, "planner-place-address") || state.document.querySelector("input[placeholder='Street, City, Country']");
  const modalForm = nameInput?.closest("form") || null;
  const submitButton = queryHook(state, "planner-place-submit") || modalForm?.querySelector("button[type='submit']");
  const placeName = nameInput instanceof HTMLInputElement ? nameInput.value : "";
  const placeRow = findPlacesSidebarRowByName(state, placeName);
  const rowButtons = placeRow ? Array.from(placeRow.querySelectorAll("button")) : [];
  const plannerRow = placeName ? findVisiblePlaceRowByName(state, placeName) : null;
  const plannerButtons = plannerRow ? Array.from(plannerRow.querySelectorAll("button")) : [];
  const reorderButtons = plannerButtons.filter((button) => {
    if (!isVisible(button)) return false;
    return button.querySelector("svg") !== null;
  });

  return {
    addPlacePoint: pickPointByText(buttons, ["Add Place/Activity"], { title: true }),
    modalOpen: !!nameInput,
    namePoint: centerOf(nameInput),
    nameValue: placeName,
    descriptionPoint: centerOf(descriptionInput),
    addressPoint: centerOf(addressInput),
    submitPoint: centerOf(submitButton || null),
    submitDisabled: submitButton instanceof HTMLButtonElement ? submitButton.disabled : false,
    addToDayPoint: (() => {
      const button = rowButtons.find((btn) => {
        if (!isVisible(btn)) return false;
        if (!(btn instanceof HTMLButtonElement) || btn.disabled) return false;
        const rect = btn.getBoundingClientRect();
        return rect.width <= 28 && rect.height <= 28 && btn.querySelector("svg") !== null;
      });
      return centerOf(button || null);
    })(),
    morningPoint: pickPointByText(plannerButtons, ["Morning"], { title: true }),
    afternoonPoint: pickPointByText(plannerButtons, ["Afternoon"], { title: true }),
    nightPoint: pickPointByText(plannerButtons, ["Night"], { title: true }),
    moveUpPoint: centerOf(reorderButtons[reorderButtons.length >= 2 ? reorderButtons.length - 2 : 0] || null),
    moveDownPoint: centerOf(reorderButtons[reorderButtons.length - 1] || null),
    activeField: (() => {
      const active = state.document.activeElement;
      if (active instanceof HTMLElement) {
        const hook = active.getAttribute("data-bombadil");
        if (hook === "planner-place-name") return "planner-name";
        if (hook === "planner-place-address") return "planner-address";
        if (hook === "planner-place-description") return "planner-description";
      }
      if (active instanceof HTMLInputElement) {
        if (active.placeholder === "e.g. Eiffel Tower") return "planner-name";
        if (active.placeholder === "Street, City, Country") return "planner-address";
      }
      if (active instanceof HTMLTextAreaElement && active.placeholder === "Short description...") return "planner-description";
      return "other";
    })(),
    visibleText: visibleBodyText(state),
  };
});

export const bypassDoesNotLeaveYouOnLogin = always(
  now(() => route.current === "/login" && loginFormVisible.current).implies(
    eventually(() => route.current !== "/login").within(5, "seconds"),
  ),
);

export const errorsDoNotPileUp = always(() => toastCount.current <= 5);

export const loadingDoesNotHangForever = always(
  now(() => spinnerCount.current > 0).implies(
    eventually(() => spinnerCount.current === 0).within(20, "seconds"),
  ),
);

export const tripCreationSettles = always(
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

export const plannerLoadsWithNavigation = always(() => {
  if (!plannerState.current) return true;
  if (!plannerState.current.shellReady) return true;
  return plannerState.current.plannerTabs > 0;
});

export const plannerHasSequentialDayBadges = always(() => {
  if (!plannerState.current) return true;
  const badges = plannerState.current.dayBadges.slice().sort((a, b) => a - b);
  if (badges.length === 0) return true;
  return badges.every((value, index) => value === index + 1);
});

export const bookingTitlesEventuallyAppear = always(() => {
  const title = (reservationsState.current?.titleValue || "").trim();
  return now(() => title.length > 3)
    .and(next(() => reservationsState.current?.modalOpen === false))
    .implies(
      eventually(() => visibleText.current.includes(title)).within(20, "seconds"),
    );
});

export const reservationLocationsEventuallyAppear = always(() => {
  const title = (reservationsState.current?.titleValue || "").trim();
  const location = (reservationsState.current?.locationValue || "").trim();
  return now(() => title.length > 3 && location.length > 2)
    .and(next(() => reservationsState.current?.modalOpen === false))
    .implies(
      eventually(() => visibleText.current.includes(location)).within(20, "seconds"),
    );
});

export const packingItemsEventuallyAppear = always(() => {
  const item = (packingState.current?.itemValue || "").trim();
  return now(() => item.length > 2)
    .and(next(() => (packingState.current?.itemValue || "") === ""))
    .implies(
      eventually(() => packingState.current?.visibleText.includes(item) || false).within(15, "seconds"),
    );
});

export const budgetEntriesEventuallyAppear = always(() => {
  const item = (budgetState.current?.nameValue || "").trim();
  return now(() => item.length > 2)
    .and(next(() => (budgetState.current?.nameValue || "") === ""))
    .implies(
      eventually(() => budgetState.current?.visibleText.includes(item) || false).within(20, "seconds"),
    );
});

export const chatMessagesEventuallyAppear = always(() => {
  const message = (collabState.current?.chatValue || "").trim();
  return now(() => message.length > 2)
    .and(next(() => (collabState.current?.chatValue || "") === ""))
    .implies(
      eventually(() => collabState.current?.visibleText.includes(message) || false).within(15, "seconds"),
    );
});

export const notesEventuallyAppear = always(() => {
  const title = (collabState.current?.noteTitleValue || "").trim();
  return now(() => title.length > 2)
    .and(next(() => collabState.current?.noteModalOpen === false))
    .implies(
      eventually(() => collabState.current?.visibleText.includes(title) || false).within(20, "seconds"),
    );
});

export const pollsEventuallyAppear = always(() => {
  const question = (collabState.current?.pollQuestionValue || "").trim();
  return now(() => question.length > 4)
    .and(next(() => collabState.current?.pollModalOpen === false))
    .implies(
      eventually(() => collabState.current?.visibleText.includes(question) || false).within(20, "seconds"),
    );
});

export const plannerPlacesEventuallyAppear = always(() => {
  const name = (planningState.current?.nameValue || "").trim();
  return now(() => name.length > 2)
    .and(next(() => planningState.current?.modalOpen === false))
    .implies(
      eventually(() => planningState.current?.visibleText.includes(name) || false).within(20, "seconds"),
    );
});

export const plannerSectionsEventuallyAppear = always(
  now(() => /^\/trips\/\d+/.test(route.current) && !!plannerState.current?.shellReady).implies(
    eventually(() =>
      visibleText.current.includes("Morning") &&
      visibleText.current.includes("Afternoon") &&
      visibleText.current.includes("Night")
    ).within(10, "seconds"),
  ),
);

export const pollOptionsEventuallyAppear = always(() => {
  const [optionOne, optionTwo] = collabState.current?.pollOptionValues || [];
  return now(() => (optionOne || "").trim().length > 1 && (optionTwo || "").trim().length > 1)
    .and(next(() => collabState.current?.pollModalOpen === false))
    .implies(
      eventually(() => visibleText.current.includes(optionOne || "") && visibleText.current.includes(optionTwo || "")).within(20, "seconds"),
    );
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

const bookingTitles = [
  "Bombadil Train 204",
  "Bombadil Harbor Hotel",
  "Bombadil Dinner Booking",
];

const locations = [
  "123 Test Street",
  "42 Explorer Avenue",
  "7 Localhost Plaza",
];

const notes = [
  "Bombadil booking note for realistic local testing.",
  "Exercise booking persistence without using uploads.",
];

const packingItems = [
  "Bombadil rain jacket",
  "Bombadil charger",
  "Bombadil walking shoes",
];

const budgetEntries = [
  "Bombadil museum tickets",
  "Bombadil metro pass",
  "Bombadil dinner split",
];

const chatMessages = [
  "Bombadil check-in looks stable from chat.",
  "Bombadil added a planning update in collab.",
];

const noteTitles = [
  "Bombadil trip note",
  "Bombadil planning checklist",
];

const noteBodies = [
  "Collect confirmations, budget assumptions, and meeting points.",
  "Keep this trip focused on one itinerary for Bombadil coverage.",
];

const pollQuestions = [
  "What should we do on day two?",
  "Which dinner spot should we reserve?",
];

const pollOptions = [
  ["Night market", "River walk"],
  ["Sushi", "Tapas"],
];

const plannerPlaceNames = [
  "Bombadil coffee stop",
  "Bombadil museum visit",
  "Bombadil sunset walk",
];

const plannerPlaceDescriptions = [
  "Planner event created by Bombadil for day scheduling coverage.",
  "Exercise assignment and section changes inside the trip planner.",
];

const plannerAddresses = [
  "1 Testing Square",
  "99 Planner Avenue",
  "500 Local Route",
];

const openCreateTripModal = actions(() => {
  if (route.current !== "/dashboard") return [];
  if (visibleTripTitles.current.length > 0) return [];
  const point = createTripButtonPoint.current;
  return point ? [{ Click: { name: "open create trip modal", point } }] : [];
});

const focusTripTitle = actions(() => {
  const point = tripModalState.current?.titlePoint;
  return point ? [{ Click: { name: "focus trip title", point } }] : [];
});

const typeTripTitle = actions(() => {
  if (activeField.current !== "title") return [];
  if ((tripModalState.current?.title || "").length > 0) return [];
  return tripTitles.map((title) => ({
    TypeText: { text: title, delayMillis: 10 },
  }));
});

const focusTripDescription = actions(() => {
  if (!tripModalState.current?.title) return [];
  const point = tripModalState.current.descriptionPoint;
  return point ? [{ Click: { name: "focus trip description", point } }] : [];
});

const typeTripDescription = actions(() => {
  if (activeField.current !== "description") return [];
  return tripDescriptions.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const openStartDatePicker = actions(() => {
  if (datePickerOpen.current) return [];
  const point = tripModalState.current?.startDatePoint;
  return point ? [{ Click: { name: "open start date picker", point } }] : [];
});

const pickStartDate = actions(() => {
  if (!datePickerOpen.current) return [];
  return dateCellPoints.current.map((entry) => ({
    Click: { name: `pick ${entry.name} for start`, point: entry.point },
  }));
});

const openEndDatePicker = actions(() => {
  if (datePickerOpen.current) return [];
  if (!tripModalState.current?.title) return [];
  const point = tripModalState.current.endDatePoint;
  return point ? [{ Click: { name: "open end date picker", point } }] : [];
});

const pickEndDate = actions(() => {
  if (!datePickerOpen.current) return [];
  return dateCellPoints.current.map((entry) => ({
    Click: { name: `pick ${entry.name} for end`, point: entry.point },
  }));
});

const submitTripModal = actions(() => {
  const modal = tripModalState.current;
  if (!modal?.submitPoint) return [];
  if (!modal.title || modal.submitDisabled || modal.saving) return [];
  return [{ Click: { name: "submit trip modal", point: modal.submitPoint } }];
});

const openTripFromDashboard = actions(() => {
  if (route.current !== "/dashboard") return [];
  if (spinnerCount.current > 0) return [];
  if (tripModalState.current) return [];
  if (datePickerOpen.current) return [];
  if (planningState.current?.modalOpen) return [];
  return tripCardHeadingPoints.current.map((entry) => ({
    Click: { name: `open trip ${entry.name}`, point: entry.point },
  }));
});

const returnToDashboard = actions(() => {
  if (!/^\/trips\/\d+/.test(route.current)) return [];
  const point = dashboardLinkPoint.current;
  return point ? [{ Click: { name: "return to dashboard", point } }] : [];
});

const openBookingsTab = actions(() => {
  const point = plannerState.current?.bookingsTabPoint;
  return point ? [{ Click: { name: "open bookings tab", point } }] : [];
});

const openPackingTab = actions(() => {
  const point = plannerState.current?.packingTabPoint;
  return point ? [{ Click: { name: "open packing tab", point } }] : [];
});

const openBudgetTab = actions(() => {
  const point = plannerState.current?.budgetTabPoint;
  return point ? [{ Click: { name: "open budget tab", point } }] : [];
});

const openCollabTab = actions(() => {
  const point = plannerState.current?.collabTabPoint;
  return point ? [{ Click: { name: "open collab tab", point } }] : [];
});

const openPlanTab = actions(() => {
  const point = plannerState.current?.planTabPoint;
  return point ? [{ Click: { name: "open plan tab", point } }] : [];
});

const openAddPlaceModal = actions(() => {
  if (planningState.current?.modalOpen) return [];
  const point = planningState.current?.addPlacePoint;
  return point ? [{ Click: { name: "open add place modal", point } }] : [];
});

const focusPlannerPlaceName = actions(() => {
  const point = planningState.current?.namePoint;
  return point ? [{ Click: { name: "focus planner place name", point } }] : [];
});

const typePlannerPlaceName = actions(() => {
  if (planningState.current?.activeField !== "planner-name") return [];
  if ((planningState.current?.nameValue || "").length > 0) return [];
  return plannerPlaceNames.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusPlannerPlaceDescription = actions(() => {
  if (!(planningState.current?.nameValue || "").trim()) return [];
  const point = planningState.current?.descriptionPoint;
  return point ? [{ Click: { name: "focus planner place description", point } }] : [];
});

const typePlannerPlaceDescription = actions(() => {
  if (planningState.current?.activeField !== "planner-description") return [];
  return plannerPlaceDescriptions.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusPlannerPlaceAddress = actions(() => {
  if (!(planningState.current?.nameValue || "").trim()) return [];
  const point = planningState.current?.addressPoint;
  return point ? [{ Click: { name: "focus planner place address", point } }] : [];
});

const typePlannerPlaceAddress = actions(() => {
  if (planningState.current?.activeField !== "planner-address") return [];
  return plannerAddresses.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const submitPlannerPlace = actions(() => {
  const state = planningState.current;
  if (!state?.submitPoint || state.submitDisabled) return [];
  if (!(state.nameValue || "").trim()) return [];
  return [{ Click: { name: "submit planner place", point: state.submitPoint } }];
});

const assignPlannerPlaceToDay = actions(() => {
  const state = planningState.current;
  if (!state?.addToDayPoint) return [];
  if (!(state.nameValue || "").trim()) return [];
  if (state.morningPoint || state.afternoonPoint || state.nightPoint) return [];
  return [{ Click: { name: "assign planner place to day", point: state.addToDayPoint } }];
});

const movePlannerPlaceToMorning = actions(() => {
  const point = planningState.current?.morningPoint;
  return point ? [{ Click: { name: "move planner place to morning", point } }] : [];
});

const movePlannerPlaceToAfternoon = actions(() => {
  const point = planningState.current?.afternoonPoint;
  return point ? [{ Click: { name: "move planner place to afternoon", point } }] : [];
});

const movePlannerPlaceToNight = actions(() => {
  const point = planningState.current?.nightPoint;
  return point ? [{ Click: { name: "move planner place to night", point } }] : [];
});

const reorderPlannerPlaceUp = actions(() => {
  const point = planningState.current?.moveUpPoint;
  return point ? [{ Click: { name: "reorder planner place up", point } }] : [];
});

const reorderPlannerPlaceDown = actions(() => {
  const point = planningState.current?.moveDownPoint;
  return point ? [{ Click: { name: "reorder planner place down", point } }] : [];
});

const openReservationModal = actions(() => {
  if (reservationsState.current?.modalOpen) return [];
  const point = reservationsState.current?.addPoint;
  return point ? [{ Click: { name: "open reservation modal", point } }] : [];
});

const focusReservationTitle = actions(() => {
  const point = reservationsState.current?.titlePoint;
  return point ? [{ Click: { name: "focus reservation title", point } }] : [];
});

const typeReservationTitle = actions(() => {
  if (reservationsState.current?.activeField !== "reservation-title") return [];
  if ((reservationsState.current?.titleValue || "").length > 0) return [];
  return bookingTitles.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusReservationLocation = actions(() => {
  if (!(reservationsState.current?.titleValue || "").trim()) return [];
  const point = reservationsState.current?.locationPoint;
  return point ? [{ Click: { name: "focus reservation location", point } }] : [];
});

const typeReservationLocation = actions(() => {
  if (reservationsState.current?.activeField !== "reservation-location") return [];
  return locations.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusReservationNotes = actions(() => {
  if (!(reservationsState.current?.titleValue || "").trim()) return [];
  const point = reservationsState.current?.notesPoint;
  return point ? [{ Click: { name: "focus reservation notes", point } }] : [];
});

const typeReservationNotes = actions(() => {
  if (reservationsState.current?.activeField !== "reservation-notes") return [];
  return notes.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const submitReservation = actions(() => {
  const state = reservationsState.current;
  if (!state?.submitPoint || state.submitDisabled) return [];
  if (!(state.titleValue || "").trim()) return [];
  return [{ Click: { name: "submit reservation", point: state.submitPoint } }];
});

const openPackingAdd = actions(() => {
  const point = packingState.current?.addPoint;
  return point ? [{ Click: { name: "open packing add item", point } }] : [];
});

const focusPackingItem = actions(() => {
  const point = packingState.current?.itemPoint;
  return point ? [{ Click: { name: "focus packing item", point } }] : [];
});

const typePackingItem = actions(() => {
  if (packingState.current?.activeField !== "packing-item") return [];
  if ((packingState.current?.itemValue || "").length > 0) return [];
  return packingItems.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const submitPackingItem = actions(() => {
  const state = packingState.current;
  if (!state?.submitPoint) return [];
  if (!(state.itemValue || "").trim()) return [];
  return [{ Click: { name: "submit packing item", point: state.submitPoint } }];
});

const focusBudgetName = actions(() => {
  const point = budgetState.current?.namePoint;
  return point ? [{ Click: { name: "focus budget name", point } }] : [];
});

const typeBudgetName = actions(() => {
  if (budgetState.current?.activeField !== "budget-name") return [];
  if ((budgetState.current?.nameValue || "").length > 0) return [];
  return budgetEntries.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusBudgetPrice = actions(() => {
  if (!(budgetState.current?.nameValue || "").trim()) return [];
  const point = budgetState.current?.pricePoint;
  return point ? [{ Click: { name: "focus budget price", point } }] : [];
});

const typeBudgetPrice = actions(() => {
  if (budgetState.current?.activeField !== "budget-price") return [];
  return [
    { TypeText: { text: "19.50", delayMillis: 10 } },
    { TypeText: { text: "44.00", delayMillis: 10 } },
  ];
});

const focusBudgetNote = actions(() => {
  if (!(budgetState.current?.nameValue || "").trim()) return [];
  const point = budgetState.current?.notePoint;
  return point ? [{ Click: { name: "focus budget note", point } }] : [];
});

const typeBudgetNote = actions(() => {
  if (budgetState.current?.activeField !== "budget-note") return [];
  return notes.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const submitBudgetItem = actions(() => {
  const state = budgetState.current;
  if (!state?.submitPoint) return [];
  if (!(state.nameValue || "").trim()) return [];
  return [{ Click: { name: "submit budget item", point: state.submitPoint } }];
});

const focusChatComposer = actions(() => {
  const point = collabState.current?.chatPoint;
  return point ? [{ Click: { name: "focus chat composer", point } }] : [];
});

const typeChatMessage = actions(() => {
  if (collabState.current?.activeField !== "chat") return [];
  if ((collabState.current?.chatValue || "").length > 0) return [];
  return chatMessages.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const sendChatMessage = actions(() => {
  const state = collabState.current;
  if (!state?.chatSendPoint) return [];
  if (!(state.chatValue || "").trim()) return [];
  return [{ Click: { name: "send chat message", point: state.chatSendPoint } }];
});

const openNewNote = actions(() => {
  if (collabState.current?.noteModalOpen) return [];
  const point = collabState.current?.newNotePoint;
  return point ? [{ Click: { name: "open new note", point } }] : [];
});

const focusNoteTitle = actions(() => {
  const point = collabState.current?.noteTitlePoint;
  return point ? [{ Click: { name: "focus note title", point } }] : [];
});

const typeNoteTitle = actions(() => {
  if (collabState.current?.activeField !== "note-title") return [];
  if ((collabState.current?.noteTitleValue || "").length > 0) return [];
  return noteTitles.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusNoteContent = actions(() => {
  if (!(collabState.current?.noteTitleValue || "").trim()) return [];
  const point = collabState.current?.noteContentPoint;
  return point ? [{ Click: { name: "focus note content", point } }] : [];
});

const typeNoteContent = actions(() => {
  if (collabState.current?.activeField !== "note-content") return [];
  return noteBodies.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const submitNote = actions(() => {
  const state = collabState.current;
  if (!state?.noteSubmitPoint || state.noteSubmitDisabled) return [];
  if (!(state.noteTitleValue || "").trim()) return [];
  return [{ Click: { name: "submit note", point: state.noteSubmitPoint } }];
});

const openNewPoll = actions(() => {
  if (collabState.current?.pollModalOpen) return [];
  const point = collabState.current?.newPollPoint;
  return point ? [{ Click: { name: "open new poll", point } }] : [];
});

const focusPollQuestion = actions(() => {
  const point = collabState.current?.pollQuestionPoint;
  return point ? [{ Click: { name: "focus poll question", point } }] : [];
});

const typePollQuestion = actions(() => {
  if (collabState.current?.activeField !== "poll-question") return [];
  if ((collabState.current?.pollQuestionValue || "").length > 0) return [];
  return pollQuestions.map((text) => ({
    TypeText: { text, delayMillis: 10 },
  }));
});

const focusPollOptionOne = actions(() => {
  if (!(collabState.current?.pollQuestionValue || "").trim()) return [];
  const point = collabState.current?.pollOptionOnePoint;
  return point ? [{ Click: { name: "focus poll option one", point } }] : [];
});

const typePollOptionOne = actions(() => {
  if (collabState.current?.activeField !== "poll-option-1") return [];
  if ((collabState.current?.pollOptionValues[0] || "").trim()) return [];
  return pollOptions.map((options) => ({
    TypeText: { text: options[0], delayMillis: 10 },
  }));
});

const focusPollOptionTwo = actions(() => {
  if (!(collabState.current?.pollQuestionValue || "").trim()) return [];
  const point = collabState.current?.pollOptionTwoPoint;
  return point ? [{ Click: { name: "focus poll option two", point } }] : [];
});

const typePollOptionTwo = actions(() => {
  if (collabState.current?.activeField !== "poll-option-2") return [];
  if ((collabState.current?.pollOptionValues[1] || "").trim()) return [];
  return pollOptions.map((options) => ({
    TypeText: { text: options[1], delayMillis: 10 },
  }));
});

const submitPoll = actions(() => {
  const state = collabState.current;
  if (!state?.pollSubmitPoint || state.pollSubmitDisabled) return [];
  if (!(state.pollQuestionValue || "").trim()) return [];
  return [{ Click: { name: "submit poll", point: state.pollSubmitPoint } }];
});

const voteOnPoll = actions(() =>
  collabState.current?.votePoints.map((entry) => ({
    Click: { name: `vote ${entry.name}`, point: entry.point },
  })) || [],
);

export const tripFocusedExploration = weighted([
  [1, openCreateTripModal],
  [2, focusTripTitle],
  [4, typeTripTitle],
  [1, openStartDatePicker],
  [1, pickStartDate],
  [1, openEndDatePicker],
  [1, pickEndDate],
  [2, focusTripDescription],
  [2, typeTripDescription],
  [2, submitTripModal],
  [28, openTripFromDashboard],
  [12, openPlanTab],
  [16, openAddPlaceModal],
  [10, focusPlannerPlaceName],
  [14, typePlannerPlaceName],
  [7, focusPlannerPlaceDescription],
  [8, typePlannerPlaceDescription],
  [7, focusPlannerPlaceAddress],
  [8, typePlannerPlaceAddress],
  [14, submitPlannerPlace],
  [18, assignPlannerPlaceToDay],
  [12, movePlannerPlaceToMorning],
  [12, movePlannerPlaceToAfternoon],
  [12, movePlannerPlaceToNight],
  [8, reorderPlannerPlaceUp],
  [8, reorderPlannerPlaceDown],
  [12, openBookingsTab],
  [8, openReservationModal],
  [6, focusReservationTitle],
  [8, typeReservationTitle],
  [4, focusReservationLocation],
  [4, typeReservationLocation],
  [4, focusReservationNotes],
  [4, typeReservationNotes],
  [8, submitReservation],
  [10, openPackingTab],
  [8, openPackingAdd],
  [6, focusPackingItem],
  [8, typePackingItem],
  [8, submitPackingItem],
  [10, openBudgetTab],
  [6, focusBudgetName],
  [8, typeBudgetName],
  [4, focusBudgetPrice],
  [4, typeBudgetPrice],
  [3, focusBudgetNote],
  [3, typeBudgetNote],
  [8, submitBudgetItem],
  [12, openCollabTab],
  [8, focusChatComposer],
  [8, typeChatMessage],
  [8, sendChatMessage],
  [7, openNewNote],
  [6, focusNoteTitle],
  [8, typeNoteTitle],
  [5, focusNoteContent],
  [6, typeNoteContent],
  [8, submitNote],
  [7, openNewPoll],
  [6, focusPollQuestion],
  [8, typePollQuestion],
  [4, focusPollOptionOne],
  [4, typePollOptionOne],
  [4, focusPollOptionTwo],
  [4, typePollOptionTwo],
  [7, submitPoll],
  [5, voteOnPoll],
]);
