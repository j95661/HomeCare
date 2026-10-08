export function additionProblem(left: number, right: number): { question: string; answer: string } {
  const a = Math.trunc(left);
  const b = Math.trunc(right);
  return { question: `What is ${a} + ${b}?`, answer: String(a + b) };
}

export function answerMatches(expected: string, typed: string): boolean {
  return typed.trim() === expected;
}

export function randomAddends(random: () => number = Math.random): [number, number] {
  const pick = () => 2 + Math.floor(random() * 8);
  return [pick(), pick()];
}
