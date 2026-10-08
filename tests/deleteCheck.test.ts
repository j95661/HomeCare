import { describe, expect, it } from "vitest";
import { additionProblem, answerMatches, randomAddends } from "../src/deleteCheck";

describe("delete math check", () => {
  it("asks for the sum and accepts only that number", () => {
    const problem = additionProblem(4, 7);
    expect(problem.question).toBe("What is 4 + 7?");
    expect(answerMatches(problem.answer, "11")).toBe(true);
    expect(answerMatches(problem.answer, " 11 ")).toBe(true);
    expect(answerMatches(problem.answer, "12")).toBe(false);
    expect(answerMatches(problem.answer, "")).toBe(false);
  });

  it("picks addends from 2 through 9", () => {
    const [left, right] = randomAddends(() => 0);
    expect(left).toBe(2);
    expect(right).toBe(2);
    const [highLeft, highRight] = randomAddends(() => 0.999);
    expect(highLeft).toBe(9);
    expect(highRight).toBe(9);
  });
});