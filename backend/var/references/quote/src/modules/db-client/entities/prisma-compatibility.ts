export type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false

export type Expect<Value extends true> = Value
