export interface TemporalParsed {
  date: number;
  confidence: number;
  original: string;
  type: 'absolute' | 'relative' | 'recurring';
}

const WEEKDAY_MAP: Record<string, number> = {
  // Deutsch
  montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4,
  freitag: 5, samstag: 6, sonntag: 0,
  // Englisch
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 0,
};

const MONTH_MAP: Record<string, number> = {
  // Deutsch
  januar: 0, februar: 1, maerz: 2, märz: 2, april: 3, mai: 4, juni: 5,
  juli: 6, august: 7, september: 8, oktober: 9, november: 10, dezember: 11,
  // Englisch
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const NUMBER_WORDS: Record<string, number> = {
  // Deutsch
  einer: 1, einem: 1, eine: 1, ein: 1, eins: 1,
  zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10,
  // Englisch
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  a: 1, an: 1,
};

function getNextWeekday(targetDay: number): Date {
  const now = new Date();
  const current = now.getDay();
  let daysUntil = (targetDay - current + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  const result = new Date(now);
  result.setDate(result.getDate() + daysUntil);
  result.setHours(9, 0, 0, 0);
  return result;
}

function parseNumber(text: string): number | null {
  const num = parseInt(text, 10);
  if (!isNaN(num)) return num;
  return NUMBER_WORDS[text.toLowerCase()] ?? null;
}

function extractTime(text: string): { hours: number; minutes: number } | null {
  // "um 14 Uhr", "um 14:30", "at 2pm", "at 14:30"
  const deTime = text.match(/um\s+(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
  if (deTime) {
    return { hours: parseInt(deTime[1], 10), minutes: deTime[2] ? parseInt(deTime[2], 10) : 0 };
  }

  const enTime = text.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (enTime) {
    let hours = parseInt(enTime[1], 10);
    const minutes = enTime[2] ? parseInt(enTime[2], 10) : 0;
    if (enTime[3]?.toLowerCase() === 'pm' && hours < 12) hours += 12;
    if (enTime[3]?.toLowerCase() === 'am' && hours === 12) hours = 0;
    return { hours, minutes };
  }

  return null;
}

function applyTime(date: Date, text: string): Date {
  const time = extractTime(text);
  if (time) {
    date.setHours(time.hours, time.minutes, 0, 0);
  }
  return date;
}

export function parseTemporalExpression(text: string): TemporalParsed | null {
  const lower = text.toLowerCase();

  // === ABSOLUTE: "am 15. Maerz", "am 15.3.", "March 15", "15th of March" ===

  // DE: "am 15. maerz" / "am 15. 3." / "am 15.3."
  const deDate = lower.match(/am\s+(\d{1,2})\.\s*(\d{1,2}|[a-zäöü]+)\.?/);
  if (deDate) {
    const day = parseInt(deDate[1], 10);
    let month: number;
    const monthPart = deDate[2];
    if (/^\d+$/.test(monthPart)) {
      month = parseInt(monthPart, 10) - 1;
    } else {
      month = MONTH_MAP[monthPart] ?? -1;
    }
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const result = new Date();
      result.setMonth(month, day);
      result.setHours(9, 0, 0, 0);
      if (result.getTime() < Date.now()) {
        result.setFullYear(result.getFullYear() + 1);
      }
      applyTime(result, text);
      return { date: result.getTime(), confidence: 0.9, original: deDate[0], type: 'absolute' };
    }
  }

  // EN: "March 15" / "March 15th"
  for (const [monthName, monthIdx] of Object.entries(MONTH_MAP)) {
    const enDatePattern = new RegExp(`${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
    const enMatch = lower.match(enDatePattern);
    if (enMatch) {
      const day = parseInt(enMatch[1], 10);
      if (day >= 1 && day <= 31) {
        const result = new Date();
        result.setMonth(monthIdx, day);
        result.setHours(9, 0, 0, 0);
        if (result.getTime() < Date.now()) {
          result.setFullYear(result.getFullYear() + 1);
        }
        applyTime(result, text);
        return { date: result.getTime(), confidence: 0.9, original: enMatch[0], type: 'absolute' };
      }
    }
  }

  // === RELATIVE: naechsten/kommenden [Wochentag] / next [weekday] ===
  const nextWeekdayDE = lower.match(/(?:n[aä]chsten?|kommende[rnm]?)\s+(\w+)/);
  if (nextWeekdayDE) {
    const day = WEEKDAY_MAP[nextWeekdayDE[1]];
    if (day !== undefined) {
      const result = getNextWeekday(day);
      applyTime(result, text);
      return { date: result.getTime(), confidence: 0.8, original: nextWeekdayDE[0], type: 'relative' };
    }
  }

  // "am Montag" / "on Monday" → naechstes Vorkommen
  const onWeekday = lower.match(/(?:am|on)\s+(\w+)/);
  if (onWeekday) {
    const day = WEEKDAY_MAP[onWeekday[1]];
    if (day !== undefined) {
      const result = getNextWeekday(day);
      applyTime(result, text);
      return { date: result.getTime(), confidence: 0.7, original: onWeekday[0], type: 'relative' };
    }
  }

  const nextWeekdayEN = lower.match(/next\s+(\w+)/);
  if (nextWeekdayEN) {
    const word = nextWeekdayEN[1];
    const day = WEEKDAY_MAP[word];
    if (day !== undefined) {
      const result = getNextWeekday(day);
      applyTime(result, text);
      return { date: result.getTime(), confidence: 0.8, original: nextWeekdayEN[0], type: 'relative' };
    }
    // "next week"
    if (word === 'week' || word === 'woche') {
      const result = new Date();
      result.setDate(result.getDate() + ((1 - result.getDay() + 7) % 7 || 7));
      result.setHours(9, 0, 0, 0);
      return { date: result.getTime(), confidence: 0.5, original: nextWeekdayEN[0], type: 'relative' };
    }
  }

  // "naechste woche"
  if (/n[aä]chste\s+woche/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + ((1 - result.getDay() + 7) % 7 || 7));
    result.setHours(9, 0, 0, 0);
    const match = lower.match(/n[aä]chste\s+woche/)!;
    return { date: result.getTime(), confidence: 0.5, original: match[0], type: 'relative' };
  }

  // === "in [N] Tagen/Stunden/Wochen" / "in [N] days/hours/weeks" ===
  const inNUnits = lower.match(/in\s+(\d+|[a-zäöü]+)\s+(tag(?:en)?|stunde[n]?|woche[n]?|monat(?:en)?|day[s]?|hour[s]?|week[s]?|month[s]?)/i);
  if (inNUnits) {
    const n = parseNumber(inNUnits[1]);
    if (n && n > 0 && n <= 365) {
      const unit = inNUnits[2].toLowerCase();
      const result = new Date();
      if (/^(tag|day)/.test(unit)) {
        result.setDate(result.getDate() + n);
        result.setHours(9, 0, 0, 0);
      } else if (/^(stunde|hour)/.test(unit)) {
        result.setTime(result.getTime() + n * 60 * 60 * 1000);
      } else if (/^(woche|week)/.test(unit)) {
        result.setDate(result.getDate() + n * 7);
        result.setHours(9, 0, 0, 0);
      } else if (/^(monat|month)/.test(unit)) {
        result.setMonth(result.getMonth() + n);
        result.setHours(9, 0, 0, 0);
      }
      applyTime(result, text);
      return { date: result.getTime(), confidence: 0.7, original: inNUnits[0], type: 'relative' };
    }
  }

  // === Simple keywords ===

  // "uebermorgen" / "day after tomorrow"
  if (/[üu]bermorgen/i.test(lower) || /day after tomorrow/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + 2);
    result.setHours(9, 0, 0, 0);
    applyTime(result, text);
    const match = lower.match(/[üu]bermorgen|day after tomorrow/)!;
    return { date: result.getTime(), confidence: 0.8, original: match[0], type: 'relative' };
  }

  // "morgen" / "tomorrow"
  if (/\bmorgen\b/i.test(lower) && !/\bguten\s+morgen\b/i.test(lower) && !/\bmorgens\b/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + 1);
    result.setHours(9, 0, 0, 0);
    applyTime(result, text);
    return { date: result.getTime(), confidence: 0.8, original: 'morgen', type: 'relative' };
  }

  if (/\btomorrow\b/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + 1);
    result.setHours(9, 0, 0, 0);
    applyTime(result, text);
    return { date: result.getTime(), confidence: 0.8, original: 'tomorrow', type: 'relative' };
  }

  // "heute abend" / "tonight" / "today"
  if (/heute\s*abend/i.test(lower) || /\btonight\b/i.test(lower)) {
    const result = new Date();
    result.setHours(18, 0, 0, 0);
    applyTime(result, text);
    const match = lower.match(/heute\s*abend|tonight/)!;
    return { date: result.getTime(), confidence: 0.7, original: match[0], type: 'relative' };
  }

  if (/\bheute\b/i.test(lower) || /\btoday\b/i.test(lower)) {
    const result = new Date();
    result.setHours(17, 0, 0, 0);
    applyTime(result, text);
    const match = lower.match(/heute|today/)!;
    return { date: result.getTime(), confidence: 0.6, original: match[0], type: 'relative' };
  }

  // "ende der woche" / "end of week"
  if (/ende\s+der\s+woche/i.test(lower) || /end\s+of\s+(?:the\s+)?week/i.test(lower)) {
    const result = getNextWeekday(5); // Freitag
    result.setHours(17, 0, 0, 0);
    const match = lower.match(/ende\s+der\s+woche|end\s+of\s+(?:the\s+)?week/)!;
    return { date: result.getTime(), confidence: 0.5, original: match[0], type: 'relative' };
  }

  // "diese woche" / "this week"
  if (/diese\s+woche/i.test(lower) || /this\s+week/i.test(lower)) {
    const result = getNextWeekday(5);
    result.setHours(17, 0, 0, 0);
    const match = lower.match(/diese\s+woche|this\s+week/)!;
    return { date: result.getTime(), confidence: 0.5, original: match[0], type: 'relative' };
  }

  // === RECURRING: "jeden Montag" / "every Monday" / "taeglich" / "daily" ===
  const recurringDE = lower.match(/jeden\s+(\w+)/);
  if (recurringDE) {
    const day = WEEKDAY_MAP[recurringDE[1]];
    if (day !== undefined) {
      const result = getNextWeekday(day);
      return { date: result.getTime(), confidence: 0.8, original: recurringDE[0], type: 'recurring' };
    }
  }

  const recurringEN = lower.match(/every\s+(\w+)/);
  if (recurringEN) {
    const day = WEEKDAY_MAP[recurringEN[1]];
    if (day !== undefined) {
      const result = getNextWeekday(day);
      return { date: result.getTime(), confidence: 0.8, original: recurringEN[0], type: 'recurring' };
    }
  }

  if (/\bt[aä]glich\b/i.test(lower) || /\bdaily\b/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + 1);
    result.setHours(9, 0, 0, 0);
    const match = lower.match(/t[aä]glich|daily/)!;
    return { date: result.getTime(), confidence: 0.8, original: match[0], type: 'recurring' };
  }

  if (/\bw[oö]chentlich\b/i.test(lower) || /\bweekly\b/i.test(lower)) {
    const result = new Date();
    result.setDate(result.getDate() + 7);
    result.setHours(9, 0, 0, 0);
    const match = lower.match(/w[oö]chentlich|weekly/)!;
    return { date: result.getTime(), confidence: 0.8, original: match[0], type: 'recurring' };
  }

  return null;
}
