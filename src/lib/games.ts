// Every game the homepage lists. When a game is built, give it an href and
// its card becomes a link. Nothing here decides an outcome; it is a menu.

export type Game = {
  name: string;
  blurb: string;
  kind: "original" | "slots" | "poker";
  href?: string;
};

export const games: Game[] = [
  { name: "Dice", kind: "original", blurb: "Pick a number. Roll over or under it. The odds are the number.", href: "/dice" },
  { name: "Limbo", kind: "original", blurb: "Name a multiplier. Hope the result clears it." },
  { name: "Wheel", kind: "original", blurb: "A wheel. It spins. Most of it pays less than you bet." },
  { name: "Keno", kind: "original", blurb: "Pick up to ten numbers. Watch most of them miss." },
  { name: "Mines", kind: "original", blurb: "Open tiles until you cash out or find a mine." },
  { name: "Plinko", kind: "original", blurb: "Drop a ball. The server already knows where it lands." },
  { name: "Crash", kind: "original", blurb: "A number climbs until it doesn't. Everyone sees the same one." },
  { name: "Slots", kind: "slots", blurb: "Reels, paylines and the exact return, printed on the machine." },
  { name: "Texas Hold'em", kind: "poker", blurb: "Real tables against real players. Play coins only." },
];
