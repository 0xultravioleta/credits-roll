export function explainRewards(rules, prizeText) {
  return [
    `An idea starts at ${rules.basePoints.idea} points, an assist at ${rules.basePoints.assist}, and a riff at ${rules.basePoints.riff}. Multiply by the model's confidence and round to the nearest whole point.`,
    'Earned points add to the viewer’s reputation. Credited viewers appear in the end credits with their chat quotes.',
    `Reputation sets wheel weight: take the whole-number part of its square root, add ${rules.weightBase}, and cap the result at ${rules.weightCap}. A viewer who enters without reputation gets weight ${rules.weightBase}. A heavier weight means a better chance among entered viewers; it does not guarantee a win.`,
    'Viewers enter by redeeming “Enter the Credits Wheel” with Channel Points. This needs an Affiliate or Partner channel and an enabled reward.',
    `The prize is set by the streamer. Current saved prize: “${prizeText}”.`,
    'Today the rewards are recognition, reputation, an end-credits mention and a wheel chance. Nothing is paid. The streamer is responsible for delivering the prize they describe.',
  ];
}
