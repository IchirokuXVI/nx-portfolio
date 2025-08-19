import { Observable } from "rxjs";
import { OdontogramServiceI } from "./odontogram-service";
import { beforeEach, describe, expect, it } from "@jest/globals";

export function runSharedOdontogramServiceTests(
  serviceFactory: () => OdontogramServiceI
) {
  describe("Shared OdontogramServiceI behavior", () => {
    let service: OdontogramServiceI;

    beforeEach(() => {
      service = serviceFactory();
    });

    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it("getList should return an observable", () => {
      expect(service.getList() instanceof Observable).toBe(true);
    });

    it("getById should return an observable", () => {
      expect(service.getById("1") instanceof Observable).toBe(true);
    });

    it("create should return an observable", () => {
      expect(service.create({ id: "1", name: "Test odontogram" }) instanceof Observable).toBe(true);
    });

    it("update should return an observable", () => {
      expect(service.update({ id: "1", name: "Updated odontogram" }) instanceof Observable).toBe(true);
    });
  });
}
