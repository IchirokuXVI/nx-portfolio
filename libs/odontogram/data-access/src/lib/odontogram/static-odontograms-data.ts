import { Odontogram } from "@portfolio/odontogram/models";

export const ODONTOGRAMS: readonly Odontogram[] = [
  {
    id: "1",
    name: "Odontogram 1",
    client: "1",
    additionalInformation: "Teeth extraction",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-02"),
  },
  {
    id: "2",
    name: "Odontogram 2",
    client: "1",
    additionalInformation: "Implant placement after extraction",
    createdAt: new Date("2025-03-01"),
    updatedAt: new Date("2025-03-02"),
  },
  {
    id: "3",
    name: "Odontogram 3",
    client: "1",
    additionalInformation: "Filling for teeth 27 and 37",
    createdAt: new Date("2025-04-01"),
    updatedAt: new Date("2025-04-02"),
  }
];
