import {
  DataSource,
  DataSourceConfigMessage,
  DataSourceCallbackMessage,
  DataSourceRow,
  DataSourceSubscribedMessage,
  SubscribeCallback,
} from "@finos/vuu-data";
import { VuuDataRow, VuuRange, VuuSortCol } from "@finos/vuu-protocol-types";
import { getFullRange, metadataKeys, WindowRange } from "@finos/vuu-utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const { RENDER_IDX } = metadataKeys;

const byKey = (row1: VuuDataRow, row2: VuuDataRow) =>
  row1[RENDER_IDX] - row2[RENDER_IDX];

export type SubscriptionDetails = {
  columnNames?: string[];
  range: { from: number; to: number };
  sort?: VuuSortCol[];
};

const isConfigMessage = (
  message: DataSourceCallbackMessage
): message is DataSourceConfigMessage =>
  ["aggregate", "filter", "groupBy", "sort"].includes(message.type);

export interface DataSourceHookProps {
  dataSource?: DataSource;
  onConfigChange?: (message: DataSourceConfigMessage) => void;
  onSizeChange: (size: number) => void;
  onSubscribed: (subscription: DataSourceSubscribedMessage) => void;
  range?: VuuRange;
}

//TODO allow subscription details to be set before subscribe call
export function useDataSource({
  dataSource,
  onConfigChange,
  onSizeChange,
  onSubscribed,
  range = { from: 0, to: 0 },
}: DataSourceHookProps) {
  const [, forceUpdate] = useState<unknown>(null);
  const isMounted = useRef(true);
  const hasUpdated = useRef(false);
  const rangeRef = useRef<VuuRange>({ from: 0, to: 0 });
  const rafHandle = useRef<number | null>(null);
  const data = useRef<DataSourceRow[]>([]);

  const dataWindow = useMemo(
    () => new MovingWindow(getFullRange(range)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const setData = useCallback(
    (updates: DataSourceRow[]) => {
      //     onsole.log(`%c[useDataSource] setData
      // [${updates.map(d => d[0]).join(',')}]`,'color:blue')
      for (const row of updates) {
        dataWindow.add(row);
      }

      // Why bother with the slice ?
      data.current = dataWindow.data.slice().sort(byKey);
      //     onsole.log(`%c[useDataSource] data.current has ${data.current.length} records
      // [${data.current.map(d => d[0]).join(',')}]
      //     `, 'color:blue;')
      hasUpdated.current = true;
    },
    [dataWindow]
  );

  const datasourceMessageHandler: SubscribeCallback = useCallback(
    (message) => {
      if (message.type === "subscribed") {
        onSubscribed?.(message);
      } else if (message.type === "viewport-update") {
        if (typeof message.size === "number") {
          onSizeChange?.(message.size);
          dataWindow.setRowCount(message.size);
        }
        if (message.rows) {
          setData(message.rows);
        } else if (typeof message.size === "number") {
          // TODO is this right ??????
          data.current = dataWindow.data.slice().sort(byKey);
          hasUpdated.current = true;
        }
      } else if (isConfigMessage(message)) {
        onConfigChange?.(message);
      }
    },
    [dataWindow, onConfigChange, onSizeChange, onSubscribed, setData]
  );

  useEffect(
    () => () => {
      if (rafHandle.current) {
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = null;
      }
      isMounted.current = false;
    },
    []
  );

  const refreshIfUpdated = useCallback(() => {
    if (isMounted.current) {
      if (hasUpdated.current) {
        forceUpdate({});
        hasUpdated.current = false;
      }
      rafHandle.current = requestAnimationFrame(refreshIfUpdated);
    }
  }, [forceUpdate]);

  useEffect(() => {
    rafHandle.current = requestAnimationFrame(refreshIfUpdated);
  }, [refreshIfUpdated]);

  const setRange = useCallback(
    (from, to) => {
      rangeRef.current = { from, to };
      dataSource?.setRange(from, to);
      dataWindow.setRange(from, to);
    },
    [dataSource, dataWindow]
  );

  useEffect(() => {
    dataSource?.subscribe(
      {
        range: rangeRef.current,
      },
      datasourceMessageHandler
    );

    return () => {
      dataSource?.unsubscribe();
    };
  }, [dataSource, datasourceMessageHandler]);

  return {
    data: data.current,
    setRange,
    dataSource,
  };
}

export class MovingWindow {
  public data: DataSourceRow[];
  public rowCount = 0;
  private range: WindowRange;

  constructor({ from, to }: VuuRange) {
    this.range = new WindowRange(from, to);
    //internal data is always 0 based, we add range.from to determine an offset
    this.data = new Array(to - from);
    this.rowCount = 0;
  }

  setRowCount = (rowCount: number) => {
    if (rowCount < this.data.length) {
      this.data.length = rowCount;
    }

    this.rowCount = rowCount;
  };

  add(data: DataSourceRow) {
    const [index] = data;
    if (this.isWithinRange(index)) {
      const internalIndex = index - this.range.from;
      this.data[internalIndex] = data;
    }
  }

  getAtIndex(index: number) {
    return this.range.isWithin(index) &&
      this.data[index - this.range.from] != null
      ? this.data[index - this.range.from]
      : undefined;
  }

  isWithinRange(index: number) {
    return this.range.isWithin(index);
  }

  setRange(from: number, to: number) {
    if (from !== this.range.from || to !== this.range.to) {
      const [overlapFrom, overlapTo] = this.range.overlap(from, to);
      const newData = new Array(to - from);
      for (let i = overlapFrom; i < overlapTo; i++) {
        const data = this.getAtIndex(i);
        if (data) {
          const index = i - from;
          newData[index] = data;
        }
      }
      this.data = newData;
      this.range.from = from;
      this.range.to = to;
    }
  }
}