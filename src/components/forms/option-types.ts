/** Option shapes passed from server pages into the client forms. */
export interface AccountOption {
  id: string;
  name: string;
  currency: string;
  type: string;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface FormOptions {
  accounts: AccountOption[];
  categories: CategoryOption[];
  tagNames: string[];
}
