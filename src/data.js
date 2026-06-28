export const workTypes = ["Tailor", "Cutting", "Finishing", "Checking", "Packing", "Iron", "Other"];

export const productVerticals = ["Tops", "Bottoms", "Dress", "Kurta", "Shirt", "Pant", "Jacket"];
export const productColors = ["Black", "White", "Blue", "Red", "Green", "Grey", "Navy"];
export const productSizes = ["XS", "S", "M", "L", "XL", "XXL"];
export const productWorkOptions = ["Singer", "Overlock", "Press", "Cutting", "Finishing", "Checking", "Packing", "Iron"];

export const initialProducts = [
  {
    id: 1,
    productCode: "01_Tops_Black_XS",
    vertical: "Tops",
    color: "Black",
    size: "XS",
    image: "",
    prices: [
      { work: "Singer", rate: 18 },
      { work: "Overlock", rate: 8 },
      { work: "Press", rate: 5 }
    ]
  },
  {
    id: 2,
    productCode: "02_Shirt_White_M",
    vertical: "Shirt",
    color: "White",
    size: "M",
    image: "",
    prices: [
      { work: "Singer", rate: 22 },
      { work: "Overlock", rate: 9 },
      { work: "Press", rate: 6 }
    ]
  }
];

export const initialWorkers = [
  {
    id: 1,
    workerId: "GW-1001",
    name: "Rafiq Ansari",
    mobile: "9876543101",
    address: "Sector 4, Noida",
    workType: "Tailor",
    workRates: [
      { work: "Singer", rate: 18 },
      { work: "Overlock", rate: 5 }
    ],
    joiningDate: "2024-04-12",
    status: "Active"
  },
  {
    id: 2,
    workerId: "GW-1002",
    name: "Meena Devi",
    mobile: "9876543102",
    address: "Loni Road, Delhi",
    workType: "Checking",
    workRates: [
      { work: "Checking", rate: 7 }
    ],
    joiningDate: "2023-11-01",
    status: "Active"
  },
  {
    id: 3,
    workerId: "GW-1003",
    name: "Salman Khan",
    mobile: "9876543103",
    address: "Okhla Phase 2",
    workType: "Cutting",
    workRates: [
      { work: "Cutting", rate: 12 }
    ],
    joiningDate: "2022-08-19",
    status: "Active"
  },
  {
    id: 4,
    workerId: "GW-1004",
    name: "Pooja Sharma",
    mobile: "9876543104",
    address: "Faridabad NIT",
    workType: "Packing",
    workRates: [
      { work: "Packing", rate: 4 }
    ],
    joiningDate: "2024-01-06",
    status: "Inactive"
  },
  {
    id: 5,
    workerId: "GW-1005",
    name: "Imran Qureshi",
    mobile: "9876543105",
    address: "Sangam Vihar",
    workType: "Iron",
    workRates: [
      { work: "Press", rate: 5 },
      { work: "Iron", rate: 5 }
    ],
    joiningDate: "2023-06-22",
    status: "Active"
  },
  {
    id: 6,
    workerId: "GW-1006",
    name: "Sunita Kumari",
    mobile: "9876543106",
    address: "Badarpur Border",
    workType: "Finishing",
    workRates: [
      { work: "Finishing", rate: 8 }
    ],
    joiningDate: "2023-02-15",
    status: "Active"
  }
];

export const initialStaff = [
  { id: 1, name: "Amit Malik", mobile: "9810001122", email: "admin@factory.in", password: "admin123", role: "Admin", monthlySalary: 45000 },
  { id: 2, name: "Nisha Rao", mobile: "9810001133", email: "manager@factory.in", password: "manager123", role: "Manager", monthlySalary: 32000 },
  { id: 3, name: "Deepak Verma", mobile: "9810001144", email: "entry@factory.in", password: "entry123", role: "Data Entry Operator", monthlySalary: 22000 }
];

export const initialStaffPayments = [
  { id: 1, staffId: 2, date: "2026-06-12", amount: 16000, remarks: "Part salary" }
];

export const initialProduction = [
  { id: 1, date: "2026-06-01", workerId: 1, styleId: "ST-240", styleName: "Denim Shirt", rate: 18, pieces: 145, status: "Paid" },
  { id: 2, date: "2026-06-02", workerId: 2, styleId: "ST-240", styleName: "Denim Shirt", rate: 7, pieces: 210, status: "Pending" },
  { id: 3, date: "2026-06-03", workerId: 3, styleId: "ST-241", styleName: "Cargo Pant", rate: 12, pieces: 130, status: "Pending" },
  { id: 4, date: "2026-06-04", workerId: 5, styleId: "ST-242", styleName: "Linen Kurta", rate: 9, pieces: 185, status: "Paid" },
  { id: 5, date: "2026-06-05", workerId: 6, styleId: "ST-243", styleName: "Basic Tee", rate: 8, pieces: 240, status: "Pending" },
  { id: 6, date: "2026-06-06", workerId: 1, styleId: "ST-243", styleName: "Basic Tee", rate: 15, pieces: 175, status: "Pending" },
  { id: 7, date: "2026-06-07", workerId: 3, styleId: "ST-244", styleName: "Track Pant", rate: 13, pieces: 155, status: "Paid" },
  { id: 8, date: "2026-06-08", workerId: 6, styleId: "ST-245", styleName: "School Shirt", rate: 8, pieces: 290, status: "Pending" },
  { id: 9, date: "2026-06-09", workerId: 2, styleId: "ST-246", styleName: "Uniform Apron", rate: 6, pieces: 260, status: "Pending" },
  { id: 10, date: "2026-06-10", workerId: 5, styleId: "ST-246", styleName: "Uniform Apron", rate: 8, pieces: 225, status: "Paid" }
];

export const initialAdvances = [
  { id: 1, workerId: 1, date: "2026-06-04", amount: 1200, remarks: "Family need" },
  { id: 2, workerId: 3, date: "2026-06-06", amount: 900, remarks: "Travel" },
  { id: 3, workerId: 6, date: "2026-06-08", amount: 1500, remarks: "Medical" },
  { id: 4, workerId: 2, date: "2026-06-11", amount: 700, remarks: "Advance" }
];

export const initialPayments = [
  { id: 1, workerId: 1, date: "2026-06-12", amount: 2600, remarks: "Weekly settlement" },
  { id: 2, workerId: 5, date: "2026-06-12", amount: 1800, remarks: "Weekly settlement" },
  { id: 3, workerId: 3, date: "2026-06-13", amount: 2000, remarks: "Part payment" }
];

export const initialExpenses = [
  { id: 1, date: "2026-06-02", expenseType: "Staff Salary", amount: 36000, remarks: "Monthly" },
  { id: 2, date: "2026-06-05", expenseType: "Electricity", amount: 9800, remarks: "May bill" },
  { id: 3, date: "2026-06-07", expenseType: "Packaging", amount: 6200, remarks: "Cartons and poly bags" },
  { id: 4, date: "2026-06-10", expenseType: "Transportation", amount: 4800, remarks: "Dispatch" },
  { id: 5, date: "2026-06-11", expenseType: "Rent", amount: 25000, remarks: "Factory floor" }
];

export const notifications = [
  { id: 1, title: "Monthly report ready", detail: "June production summary can be exported.", type: "Info" },
  { id: 2, title: "Low production alert", detail: "Packing output is below target this week.", type: "Warning" },
  { id: 3, title: "Advance given", detail: "Sunita Kumari received INR 1,500.", type: "Success" }
];

export function amountFor(entry) {
  return Number(entry.rate) * Number(entry.pieces);
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value || 0);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(value || 0);
}
