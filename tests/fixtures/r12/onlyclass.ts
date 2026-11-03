export class Counter {
  private n = 0;
  increment(by = 1): number {
    this.n += by;
    return this.n;
  }
  reset(): void {
    this.n = 0;
  }
}
