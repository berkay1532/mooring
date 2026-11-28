/** A short line of public-domain writing, with its author. */
export interface Quote {
  quote: string;
  author: string;
}

/** Ten public-domain lines; the paid resources serve one of them. */
export const QUOTES: readonly Quote[] = [
  { quote: "Well begun is half done.", author: "Aristotle" },
  { quote: "The only true wisdom is in knowing you know nothing.", author: "Socrates" },
  { quote: "Lost time is never found again.", author: "Benjamin Franklin" },
  { quote: "Brevity is the soul of wit.", author: "William Shakespeare" },
  { quote: "Knowledge is power.", author: "Francis Bacon" },
  { quote: "Hope is the thing with feathers that perches in the soul.", author: "Emily Dickinson" },
  { quote: "Nothing will come of nothing.", author: "William Shakespeare" },
  { quote: "It is a far, far better thing that I do, than I have ever done.", author: "Charles Dickens" },
  { quote: "Well done is better than well said.", author: "Benjamin Franklin" },
  { quote: "To be, or not to be, that is the question.", author: "William Shakespeare" },
];

/** The quote for this instant: `Date.now() % 10`. */
export function pickQuote(now: number = Date.now()): Quote {
  return QUOTES[now % QUOTES.length]!;
}
