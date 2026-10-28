// A TypeScript parameter property: `private readonly rate` declares and assigns a field.
class Converter {
  constructor(private readonly rate: number) {}

  convert(x: number): number {
    return x * this.rate;
  }
}

export function convert(x: number): number {
  return new Converter(2).convert(x);
}
