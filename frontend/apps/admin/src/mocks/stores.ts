export interface Store {
  id: string;
  name: string;
  address: string;
  city: string;
  status: "active" | "maintenance" | "inactive";
  type: "company" | "condo";
}

export const storesFixture: Store[] = [
  { id: "st-01", name: "Agiliz TechPark Faria Lima", address: "Av. Brig. Faria Lima, 3477", city: "São Paulo", status: "active", type: "company" },
  { id: "st-02", name: "Agiliz Condomínio Villa Verde", address: "Rua das Camélias, 220", city: "São Paulo", status: "active", type: "condo" },
  { id: "st-03", name: "Agiliz Torre Vinhedo", address: "Av. Nações Unidas, 12901", city: "São Paulo", status: "maintenance", type: "company" },
  { id: "st-04", name: "Agiliz Ed. Jardins do Lago", address: "Rua Harmonia, 88", city: "São Paulo", status: "active", type: "condo" },
  { id: "st-05", name: "Agiliz Campus Barueri", address: "Al. Rio Negro, 500", city: "Barueri", status: "active", type: "company" },
  { id: "st-06", name: "Agiliz Cond. Parque das Águas", address: "Rua Turmalina, 145", city: "Osasco", status: "inactive", type: "condo" },
  { id: "st-07", name: "Agiliz Hub Berrini", address: "Av. Eng. Luís Carlos Berrini, 1500", city: "São Paulo", status: "active", type: "company" },
  { id: "st-08", name: "Agiliz Ed. Bela Vista", address: "Rua Bela Cintra, 1000", city: "São Paulo", status: "active", type: "condo" },
  { id: "st-09", name: "Agiliz Distrito Anhanguera", address: "Rod. Anhanguera, km 23", city: "Cajamar", status: "active", type: "company" },
  { id: "st-10", name: "Agiliz Cond. Alto da Serra", address: "Av. das Nações, 300", city: "Santana de Parnaíba", status: "maintenance", type: "condo" },
  { id: "st-11", name: "Agiliz Office Chucri Zaidan", address: "Av. Chucri Zaidan, 920", city: "São Paulo", status: "active", type: "company" },
  { id: "st-12", name: "Agiliz Cond. Reserva do Bosque", address: "Rua dos Ipês, 77", city: "Alphaville", status: "active", type: "condo" },
  { id: "st-13", name: "Agiliz Parque Industrial Jundiaí", address: "Rod. Anhanguera, km 58", city: "Jundiaí", status: "active", type: "company" },
  { id: "st-14", name: "Agiliz Ed. Vista Alegre", address: "Rua Consolação, 2400", city: "São Paulo", status: "active", type: "condo" },
  { id: "st-15", name: "Agiliz Corp Morumbi", address: "Av. Giovanni Gronchi, 5930", city: "São Paulo", status: "inactive", type: "company" },
  { id: "st-16", name: "Agiliz Cond. Green Valley", address: "Rua das Orquídeas, 12", city: "Cotia", status: "active", type: "condo" },
  { id: "st-17", name: "Agiliz Tech Center Campinas", address: "Av. José de Souza Campos, 1000", city: "Campinas", status: "active", type: "company" },
  { id: "st-18", name: "Agiliz Ed. Solar dos Lagos", address: "Rua Marechal Deodoro, 340", city: "São Bernardo do Campo", status: "active", type: "condo" },
];
