export type Answer = {
  text: string;
  points: number;
  revealed: boolean;
};

export type Round = {
  title: string;
  question: string;
  multiplier: number;
  answers: Answer[];
  hostTip: string;
};

export const INITIAL_ROUNDS: Round[] = [
  {
    title: "Round 1: Lost & Found",
    question: "Name something people frequently lose or misplace around the house.",
    multiplier: 1,
    hostTip: "Check your pockets before answering!",
    answers: [
      { text: "Keys", points: 32, revealed: false },
      { text: "TV Remote", points: 24, revealed: false },
      { text: "Phone", points: 18, revealed: false },
      { text: "Glasses / Sunglasses", points: 12, revealed: false },
      { text: "Wallet / Purse", points: 8, revealed: false },
      { text: "Shoes", points: 6, revealed: false },
    ],
  },
  {
    title: "Round 2: Silence is Golden",
    question: "Name a specific place where you are expected to be quiet or whisper.",
    multiplier: 2,
    hostTip: "If they shout the answer, they lose the points.",
    answers: [
      { text: "Library", points: 48, revealed: false },
      { text: "Church / Place of Worship", points: 25, revealed: false },
      { text: "Cinema", points: 15, revealed: false },
      { text: "Hospital / Doctor's Office", points: 8, revealed: false },
      { text: "Courtroom", points: 4, revealed: false },
    ],
  },
  {
    title: "Round 3: Nightmares & Nerves",
    question: "Name something that many people are afraid of.",
    multiplier: 3,
    hostTip: "Spiders usually top the list, but wait for the weird ones.",
    answers: [
      { text: "Snakes", points: 26, revealed: false },
      { text: "Spiders / Bugs", points: 21, revealed: false },
      { text: "Heights", points: 14, revealed: false },
      { text: "The Dark", points: 10, revealed: false },
      { text: "Death / Dying", points: 9, revealed: false },
      { text: "Clowns", points: 6, revealed: false },
      { text: "Public Speaking", points: 5, revealed: false },
      { text: "Ghosts / Monsters", points: 4, revealed: false },
    ],
  },
];