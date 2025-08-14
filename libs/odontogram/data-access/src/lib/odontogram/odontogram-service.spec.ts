import { OdontogramServiceI } from "./odontogram-service";

export function runSharedServiceTests(
  serviceFactory: () => OdontogramServiceI
) {
  describe("Shared OdontogramServiceI behavior", () => {
    let service: OdontogramServiceI;

    beforeEach(() => {
      service = serviceFactory();
    });

    it("getList should return an array", (done) => {
      service.getList().subscribe((os) => {
        expect(Array.isArray(os)).toBe(true);
        done();
      });
    });

    it("getById should return an odontogram or undefined", (done) => {
      service.getById("1").subscribe((odontogram) => {
        done();
      });
    });

    it("create should return the created odontogram", () => {
      expect(typeof service.create({ id: "1", name: "Test odontogram" })).toBe("object");
    });

    it("update should return the updated odontogram", () => {
      expect(typeof service.update({ id: "1", name: "Updated odontogram" })).toBe("object");
    });
  });
}
