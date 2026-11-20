import React, { useState } from "react";
import DataTable, { type ColumnDef } from "./DataTable";

export default {
  title: "Components/DataTable",
  component: DataTable,
};

interface MockTransaction {
  hash: string;
  date: string;
  type: "deposit" | "withdraw" | "harvest";
  amount: string;
  status: "confirmed" | "pending" | "failed";
}

const mockTransactions: MockTransaction[] = [
  {
    hash: "0x8f3a91c4e2b7d019a5c3f8e1b2d4a6c8e0f1a2b3",
    date: "2026-11-18T14:22:00Z",
    type: "deposit",
    amount: "1,250.00 USDC",
    status: "confirmed",
  },
  {
    hash: "0x4c1d7e9a3b5f2081c6d4e2a0b8f6c4d2e0a1b2c3",
    date: "2026-11-17T09:15:00Z",
    type: "harvest",
    amount: "42.18 USDC",
    status: "confirmed",
  },
  {
    hash: "0x9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d1e3f5a7b",
    date: "2026-11-16T21:40:00Z",
    type: "withdraw",
    amount: "500.00 USDC",
    status: "pending",
  },
];

const txColumns: ColumnDef<MockTransaction>[] = [
  {
    id: "date",
    header: "Date",
    accessorKey: "date",
    sortable: true,
    hideable: false,
    cell: (row) => new Date(row.date).toLocaleString(),
  },
  {
    id: "type",
    header: "Type",
    accessorKey: "type",
    sortable: true,
    filterable: true,
    cell: (row) => <span className="capitalize">{row.type}</span>,
  },
  {
    id: "amount",
    header: "Amount",
    accessorKey: "amount",
    sortable: true,
    align: "right",
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortable: true,
    cell: (row) => <span className="capitalize">{row.status}</span>,
  },
  {
    id: "hash",
    header: "Transaction",
    accessorKey: "hash",
    filterable: true,
    cell: (row) => `${row.hash.slice(0, 8)}…${row.hash.slice(-6)}`,
  },
];

export function TransactionHistoryTable() {
  const [page, setPage] = useState(1);
  return (
    <div className="p-6">
      <DataTable
        columns={txColumns}
        data={mockTransactions}
        getRowKey={(row) => row.hash}
        caption="Transaction history"
        pagination={{
          page,
          pageSize: 10,
          onPageChange: setPage,
          itemLabel: "transactions",
        }}
      />
    </div>
  );
}

interface MockLeaderboardEntry {
  userId: string;
  rank: number;
  shareBalance: number;
  usdValue: number;
  rankChange: number | null;
}

const mockLeaderboard: MockLeaderboardEntry[] = [
  { userId: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", rank: 1, shareBalance: 12450.5, usdValue: 13197.53, rankChange: 2 },
  { userId: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR", rank: 2, shareBalance: 9820.12, usdValue: 10409.33, rankChange: -1 },
  { userId: "GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM", rank: 3, shareBalance: 7540.0, usdValue: 7992.4, rankChange: 0 },
];

const leaderboardColumns: ColumnDef<MockLeaderboardEntry>[] = [
  {
    id: "rank",
    header: "Rank",
    accessorKey: "rank",
    sortable: true,
    hideable: false,
    cell: (row) => `#${row.rank}`,
  },
  {
    id: "holder",
    header: "Vault holder",
    accessorKey: "userId",
    filterable: true,
    cell: (row) => <span className="font-mono">{`${row.userId.slice(0, 6)}…${row.userId.slice(-4)}`}</span>,
  },
  {
    id: "shares",
    header: "Shares",
    accessorKey: "shareBalance",
    sortable: true,
    align: "right",
    cell: (row) => row.shareBalance.toLocaleString(undefined, { maximumFractionDigits: 4 }),
  },
  {
    id: "usdValue",
    header: "USD value",
    accessorKey: "usdValue",
    sortable: true,
    align: "right",
    cell: (row) => `$${row.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
  },
  {
    id: "rankChange",
    header: "Rank change",
    accessorKey: "rankChange",
    sortable: true,
    align: "right",
    cell: (row) => (row.rankChange === null ? "—" : row.rankChange > 0 ? `▲ ${row.rankChange}` : row.rankChange < 0 ? `▼ ${Math.abs(row.rankChange)}` : "—"),
  },
];

export function LeaderboardTable() {
  return (
    <div className="p-6">
      <DataTable
        columns={leaderboardColumns}
        data={mockLeaderboard}
        getRowKey={(row) => row.userId}
        caption="Top vault holders, current rank and rank movement"
      />
    </div>
  );
}

interface MockProposal {
  id: number;
  title: string;
  status: string;
  votesFor: number;
  requiredSignatures: number;
  proposer: string;
  createdAt: string;
}

const mockProposals: MockProposal[] = [
  {
    id: 42,
    title: "Increase USDC Vault Cap to 10M",
    status: "Active",
    votesFor: 3,
    requiredSignatures: 5,
    proposer: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    createdAt: "2026-11-15T10:00:00Z",
  },
  {
    id: 41,
    title: "Add Stellar DEX Yield Strategy",
    status: "Executable",
    votesFor: 5,
    requiredSignatures: 5,
    proposer: "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR",
    createdAt: "2026-11-10T16:30:00Z",
  },
  {
    id: 40,
    title: "Reduce Performance Fee to 8%",
    status: "Executed",
    votesFor: 5,
    requiredSignatures: 5,
    proposer: "GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM",
    createdAt: "2026-11-01T08:45:00Z",
  },
];

const proposalColumns: ColumnDef<MockProposal>[] = [
  {
    id: "id",
    header: "ID",
    accessorKey: "id",
    sortable: true,
    hideable: false,
    cell: (row) => `#${row.id}`,
  },
  {
    id: "title",
    header: "Proposal",
    accessorKey: "title",
    sortable: true,
    filterable: true,
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    sortable: true,
  },
  {
    id: "votes",
    header: "Signatures",
    accessorFn: (row) => row.votesFor,
    sortable: true,
    align: "right",
    cell: (row) => `${row.votesFor} / ${row.requiredSignatures}`,
  },
  {
    id: "createdAt",
    header: "Created",
    accessorKey: "createdAt",
    sortable: true,
    cell: (row) => new Date(row.createdAt).toLocaleDateString(),
  },
];

export function GovernanceProposalsTable() {
  return (
    <div className="p-6">
      <DataTable
        columns={proposalColumns}
        data={mockProposals}
        getRowKey={(row) => row.id}
        caption="Governance proposals"
      />
    </div>
  );
}
