export class SpatialGrid {
  private readonly cells = new Map<string, number[]>();
  private readonly queryResult: number[] = [];
  private readonly queryMarks = new Map<number, number>();
  private queryToken = 0;

  constructor(private readonly cellSize: number) {}

  clear(): void {
    for (const cell of this.cells.values()) {
      cell.length = 0;
    }
  }

  insert(id: number, x: number, y: number, radius: number): void {
    const minCellX = this.toCell(x - radius);
    const maxCellX = this.toCell(x + radius);
    const minCellY = this.toCell(y - radius);
    const maxCellY = this.toCell(y + radius);

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        this.getCell(cellX, cellY).push(id);
      }
    }
  }

  query(x: number, y: number, radius: number): number[] {
    const minCellX = this.toCell(x - radius);
    const maxCellX = this.toCell(x + radius);
    const minCellY = this.toCell(y - radius);
    const maxCellY = this.toCell(y + radius);

    this.queryResult.length = 0;
    this.queryToken += 1;

    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const cell = this.cells.get(this.key(cellX, cellY));

        if (!cell) {
          continue;
        }

        for (const id of cell) {
          if (this.queryMarks.get(id) === this.queryToken) {
            continue;
          }

          this.queryMarks.set(id, this.queryToken);
          this.queryResult.push(id);
        }
      }
    }

    return this.queryResult;
  }

  private getCell(cellX: number, cellY: number): number[] {
    const key = this.key(cellX, cellY);
    let cell = this.cells.get(key);

    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }

    return cell;
  }

  private toCell(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  private key(cellX: number, cellY: number): string {
    return `${cellX},${cellY}`;
  }
}
