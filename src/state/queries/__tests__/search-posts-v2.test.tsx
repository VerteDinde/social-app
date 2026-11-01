import {type PropsWithChildren} from 'react'
import {
  notifyManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import {act, renderHook, waitFor} from '@testing-library/react-native'

import {useAppviewClient} from '#/state/session'
import {useSearchPostsV2Query} from '../search-posts-v2'

jest.mock('#/state/session', () => ({
  useAppviewClient: jest.fn(),
}))

jest.mock('#/state/preferences/moderation-opts', () => ({
  useModerationOpts: jest.fn(() => undefined),
}))

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {gcTime: Infinity, retry: false}},
  })
  const appviewClient = {
    call: jest.fn().mockResolvedValue({posts: [], cursor: 'next'}),
  }
  jest.mocked(useAppviewClient).mockReturnValue(appviewClient as never)

  const wrapper = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const renderSearch = ({
    enabled = true,
    refetchOnMount,
  }: {enabled?: boolean; refetchOnMount?: boolean} = {}) =>
    renderHook(
      (props: {enabled: boolean}) =>
        useSearchPostsV2Query({
          query: 'you can see everything',
          sort: 'latest',
          enabled: props.enabled,
          refetchOnMount,
        }),
      {wrapper, initialProps: {enabled}},
    )

  return {appviewClient, renderSearch}
}

beforeAll(() => {
  notifyManager.setNotifyFunction(callback => {
    act(callback)
  })
})

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useSearchPostsV2Query', () => {
  /*
   * A refetch can put newer posts above the ones being read, so results that
   * are already on screen must not be refreshed behind the user's back.
   */
  it('does not refetch loaded results in the background', async () => {
    const {appviewClient, renderSearch} = setup()

    const results = renderSearch()
    await waitFor(() => expect(results.result.current.isSuccess).toBe(true))
    expect(appviewClient.call).toHaveBeenCalledTimes(1)

    // Something else reading the same results mounts.
    const reader = renderSearch({refetchOnMount: false})
    expect(reader.result.current.isSuccess).toBe(true)

    // The tab is switched away from and back to.
    results.rerender({enabled: false})
    results.rerender({enabled: true})

    // The network drops and comes back.
    act(() => {
      onlineManager.setOnline(false)
    })
    act(() => {
      onlineManager.setOnline(true)
    })

    expect(results.result.current.isFetching).toBe(false)
    expect(appviewClient.call).toHaveBeenCalledTimes(1)
  })

  it('refreshes loaded results when a screen showing them opens', async () => {
    const {appviewClient, renderSearch} = setup()

    const first = renderSearch()
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()

    const second = renderSearch()
    expect(second.result.current.isFetching).toBe(true)
    await waitFor(() => expect(second.result.current.isFetching).toBe(false))

    expect(appviewClient.call).toHaveBeenCalledTimes(2)
  })

  it('refetches on pull-to-refresh', async () => {
    const {appviewClient, renderSearch} = setup()

    const results = renderSearch()
    await waitFor(() => expect(results.result.current.isSuccess).toBe(true))

    await act(() => results.result.current.refetch())

    expect(appviewClient.call).toHaveBeenCalledTimes(2)
  })
})
